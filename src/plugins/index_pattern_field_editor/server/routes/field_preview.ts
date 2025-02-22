/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { schema } from '@kbn/config-schema';
import { HttpResponsePayload } from 'kibana/server';

import { API_BASE_PATH } from '../../common/constants';
import { RouteDependencies } from '../types';
import { handleEsError } from '../shared_imports';

const bodySchema = schema.object({
  index: schema.string(),
  script: schema.object({ source: schema.string() }),
  context: schema.oneOf([
    schema.literal('boolean_field'),
    schema.literal('date_field'),
    schema.literal('double_field'),
    schema.literal('geo_point_field'),
    schema.literal('ip_field'),
    schema.literal('keyword_field'),
    schema.literal('long_field'),
  ]),
  document: schema.object({}, { unknowns: 'allow' }),
});

export const registerFieldPreviewRoute = ({ router }: RouteDependencies): void => {
  router.post(
    {
      path: `${API_BASE_PATH}/field_preview`,
      validate: {
        body: bodySchema,
      },
    },
    async (ctx, req, res) => {
      const { client } = ctx.core.elasticsearch;

      const body = JSON.stringify({
        script: req.body.script,
        context: req.body.context,
        context_setup: {
          document: req.body.document,
          index: req.body.index,
        } as any,
      });

      try {
        const response = await client.asCurrentUser.scriptsPainlessExecute({
          // @ts-expect-error `ExecutePainlessScriptRequest.body` does not allow `string`
          body,
        });

        const fieldValue = (response.body.result as any[]) as HttpResponsePayload;

        return res.ok({ body: { values: fieldValue } });
      } catch (error) {
        // Assume invalid painless script was submitted
        // Return 200 with error object
        const handleCustomError = () => {
          return res.ok({
            body: { values: [], ...error.body },
          });
        };

        return handleEsError({ error, response: res, handleCustomError });
      }
    }
  );
};
