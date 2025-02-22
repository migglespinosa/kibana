/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, SavedObjectsClientContract } from 'src/core/server';
import { i18n } from '@kbn/i18n';
import { groupBy, omit, pick, isEqual } from 'lodash';

import type {
  NewPackagePolicy,
  AgentPolicy,
  Installation,
  Output,
  PreconfiguredAgentPolicy,
  PreconfiguredPackage,
  PreconfigurationError,
} from '../../common';
import { AGENT_POLICY_SAVED_OBJECT_TYPE } from '../../common';

import {
  PRECONFIGURATION_DELETION_RECORD_SAVED_OBJECT_TYPE,
  PRECONFIGURATION_LATEST_KEYWORD,
} from '../constants';

import { escapeSearchQueryPhrase } from './saved_object';

import { pkgToPkgKey } from './epm/registry';
import { getInstallation, getPackageInfo } from './epm/packages';
import { ensurePackagesCompletedInstall } from './epm/packages/install';
import { bulkInstallPackages } from './epm/packages/bulk_install_packages';
import { agentPolicyService, addPackageToAgentPolicy } from './agent_policy';
import type { InputsOverride } from './package_policy';
import { overridePackageInputs } from './package_policy';
import { appContextService } from './app_context';

interface PreconfigurationResult {
  policies: Array<{ id: string; updated_at: string }>;
  packages: string[];
  nonFatalErrors: PreconfigurationError[];
}

export async function ensurePreconfiguredPackagesAndPolicies(
  soClient: SavedObjectsClientContract,
  esClient: ElasticsearchClient,
  policies: PreconfiguredAgentPolicy[] = [],
  packages: PreconfiguredPackage[] = [],
  defaultOutput: Output
): Promise<PreconfigurationResult> {
  // Validate configured packages to ensure there are no version conflicts
  const packageNames = groupBy(packages, (pkg) => pkg.name);
  const duplicatePackages = Object.entries(packageNames).filter(
    ([, versions]) => versions.length > 1
  );
  if (duplicatePackages.length) {
    // List duplicate packages as a comma-separated list of <package-name>:<semver>
    // If there are multiple packages with duplicate versions, separate them with semicolons, e.g
    // package-a:1.0.0, package-a:2.0.0; package-b:1.0.0, package-b:2.0.0
    const duplicateList = duplicatePackages
      .map(([, versions]) => versions.map((v) => pkgToPkgKey(v)).join(', '))
      .join('; ');

    throw new Error(
      i18n.translate('xpack.fleet.preconfiguration.duplicatePackageError', {
        defaultMessage: 'Duplicate packages specified in configuration: {duplicateList}',
        values: {
          duplicateList,
        },
      })
    );
  }

  // Preinstall packages specified in Kibana config
  const preconfiguredPackages = await bulkInstallPackages({
    savedObjectsClient: soClient,
    esClient,
    packagesToInstall: packages.map((pkg) =>
      pkg.version === PRECONFIGURATION_LATEST_KEYWORD ? pkg.name : pkg
    ),
    force: true, // Always force outdated packages to be installed if a later version isn't installed
  });

  const fulfilledPackages = [];
  const rejectedPackages = [];
  for (let i = 0; i < preconfiguredPackages.length; i++) {
    const packageResult = preconfiguredPackages[i];
    if ('error' in packageResult)
      rejectedPackages.push({
        package: { name: packages[i].name, version: packages[i].version },
        error: packageResult.error,
      } as PreconfigurationError);
    else fulfilledPackages.push(packageResult);
  }

  // Keeping this outside of the Promise.all because it introduces a race condition.
  // If one of the required packages fails to install/upgrade it might get stuck in the installing state.
  // On the next call to the /setup API, if there is a upgrade available for one of the required packages a race condition
  // will occur between upgrading the package and reinstalling the previously failed package.
  // By moving this outside of the Promise.all, the upgrade will occur first, and then we'll attempt to reinstall any
  // packages that are stuck in the installing state.
  await ensurePackagesCompletedInstall(soClient, esClient);

  // Create policies specified in Kibana config
  const preconfiguredPolicies = await Promise.allSettled(
    policies.map(async (preconfiguredAgentPolicy) => {
      if (preconfiguredAgentPolicy.id) {
        // Check to see if a preconfigured policy with the same preconfiguration id was already deleted by the user
        const preconfigurationId = preconfiguredAgentPolicy.id.toString();
        const searchParams = {
          searchFields: ['id'],
          search: escapeSearchQueryPhrase(preconfigurationId),
        };
        const deletionRecords = await soClient.find({
          type: PRECONFIGURATION_DELETION_RECORD_SAVED_OBJECT_TYPE,
          ...searchParams,
        });
        const wasDeleted = deletionRecords.total > 0;
        if (wasDeleted) {
          return { created: false, deleted: preconfigurationId };
        }
      } else if (
        !preconfiguredAgentPolicy.is_default &&
        !preconfiguredAgentPolicy.is_default_fleet_server
      ) {
        throw new Error(
          i18n.translate('xpack.fleet.preconfiguration.missingIDError', {
            defaultMessage:
              '{agentPolicyName} is missing an `id` field. `id` is required, except for policies marked is_default or is_default_fleet_server.',
            values: { agentPolicyName: preconfiguredAgentPolicy.name },
          })
        );
      }

      const { created, policy } = await agentPolicyService.ensurePreconfiguredAgentPolicy(
        soClient,
        esClient,
        omit(preconfiguredAgentPolicy, 'is_managed') // Don't add `is_managed` until the policy has been fully configured
      );

      if (!created) {
        if (!policy?.is_managed) return { created, policy };
        const { hasChanged, fields } = comparePreconfiguredPolicyToCurrent(
          preconfiguredAgentPolicy,
          policy
        );
        if (hasChanged) {
          const updatedPolicy = await agentPolicyService.update(
            soClient,
            esClient,
            String(preconfiguredAgentPolicy.id),
            fields
          );
          return { created, policy: updatedPolicy };
        }
        return { created, policy };
      }

      return {
        created,
        policy,
        shouldAddIsManagedFlag: preconfiguredAgentPolicy.is_managed,
      };
    })
  );

  const fulfilledPolicies = [];
  const rejectedPolicies = [];
  for (let i = 0; i < preconfiguredPolicies.length; i++) {
    const policyResult = preconfiguredPolicies[i];
    if (policyResult.status === 'rejected') {
      rejectedPolicies.push({
        error: policyResult.reason as Error,
        agentPolicy: { name: policies[i].name },
      } as PreconfigurationError);
      continue;
    }
    fulfilledPolicies.push(policyResult.value);
    const { created, policy, shouldAddIsManagedFlag } = policyResult.value;
    if (created) {
      try {
        const preconfiguredAgentPolicy = policies[i];
        const { package_policies: packagePolicies } = preconfiguredAgentPolicy;

        const installedPackagePolicies = await Promise.all(
          packagePolicies.map(async ({ package: pkg, name, ...newPackagePolicy }) => {
            const installedPackage = await getInstallation({
              savedObjectsClient: soClient,
              pkgName: pkg.name,
            });
            if (!installedPackage) {
              throw new Error(
                i18n.translate('xpack.fleet.preconfiguration.packageMissingError', {
                  defaultMessage:
                    '{agentPolicyName} could not be added. {pkgName} is not installed, add {pkgName} to `{packagesConfigValue}` or remove it from {packagePolicyName}.',
                  values: {
                    agentPolicyName: preconfiguredAgentPolicy.name,
                    packagePolicyName: name,
                    pkgName: pkg.name,
                    packagesConfigValue: 'xpack.fleet.packages',
                  },
                })
              );
            }
            return { name, installedPackage, ...newPackagePolicy };
          })
        );
        await addPreconfiguredPolicyPackages(
          soClient,
          esClient,
          policy!,
          installedPackagePolicies!,
          defaultOutput
        );
        // If ann error happens while adding a package to the policy we will delete the policy so the setup can be retried later
      } catch (err) {
        await soClient
          .delete(AGENT_POLICY_SAVED_OBJECT_TYPE, policy!.id)
          // swallow error
          .catch((deleteErr) => appContextService.getLogger().error(deleteErr));

        throw err;
      }
      // Add the is_managed flag after configuring package policies to avoid errors
      if (shouldAddIsManagedFlag) {
        agentPolicyService.update(soClient, esClient, policy!.id, { is_managed: true });
      }
    }
  }

  return {
    policies: fulfilledPolicies.map((p) =>
      p.policy
        ? {
            id: p.policy.id!,
            updated_at: p.policy.updated_at,
          }
        : {
            id: p.deleted!,
            updated_at: i18n.translate('xpack.fleet.preconfiguration.policyDeleted', {
              defaultMessage: 'Preconfigured policy {id} was deleted; skipping creation',
              values: { id: p.deleted },
            }),
          }
    ),
    packages: fulfilledPackages.map((pkg) => pkgToPkgKey(pkg)),
    nonFatalErrors: [...rejectedPackages, ...rejectedPolicies],
  };
}

export function comparePreconfiguredPolicyToCurrent(
  policyFromConfig: PreconfiguredAgentPolicy,
  currentPolicy: AgentPolicy
) {
  const configTopLevelFields = omit(policyFromConfig, 'package_policies', 'id');
  const currentTopLevelFields = pick(currentPolicy, ...Object.keys(configTopLevelFields));

  return {
    hasChanged: !isEqual(configTopLevelFields, currentTopLevelFields),
    fields: configTopLevelFields,
  };
}

async function addPreconfiguredPolicyPackages(
  soClient: SavedObjectsClientContract,
  esClient: ElasticsearchClient,
  agentPolicy: AgentPolicy,
  installedPackagePolicies: Array<
    Partial<Omit<NewPackagePolicy, 'inputs'>> & {
      name: string;
      installedPackage: Installation;
      inputs?: InputsOverride[];
    }
  >,
  defaultOutput: Output
) {
  // Add packages synchronously to avoid overwriting
  for (const { installedPackage, name, description, inputs } of installedPackagePolicies) {
    const packageInfo = await getPackageInfo({
      savedObjectsClient: soClient,
      pkgName: installedPackage.name,
      pkgVersion: installedPackage.version,
    });

    await addPackageToAgentPolicy(
      soClient,
      esClient,
      installedPackage,
      agentPolicy,
      defaultOutput,
      name,
      description,
      (policy) => overridePackageInputs(policy, packageInfo, inputs)
    );
  }
}
