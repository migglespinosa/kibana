/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery } from '../../../../../observability/server';
import {
  SERVICE_NAME,
  TRANSACTION_TYPE,
} from '../../../../common/elasticsearch_fieldnames';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { AlertParams } from '../../../routes/alerts/chart_preview';
import {
  getDocumentTypeFilterForAggregatedTransactions,
  getProcessorEventForAggregatedTransactions,
  getSearchAggregatedTransactions,
} from '../../helpers/aggregated_transactions';
import { Setup, SetupTimeRange } from '../../helpers/setup_request';
import {
  calculateFailedTransactionRate,
  getOutcomeAggregation,
} from '../../helpers/transaction_error_rate';

export async function getTransactionErrorRateChartPreview({
  setup,
  alertParams,
}: {
  setup: Setup & SetupTimeRange;
  alertParams: AlertParams;
}) {
  const searchAggregatedTransactions = await getSearchAggregatedTransactions({
    ...setup,
    kuery: '',
  });

  const { apmEventClient, start, end } = setup;
  const { serviceName, environment, transactionType, interval } = alertParams;

  const outcomes = getOutcomeAggregation();

  const params = {
    apm: {
      events: [
        getProcessorEventForAggregatedTransactions(
          searchAggregatedTransactions
        ),
      ],
    },
    body: {
      size: 0,
      query: {
        bool: {
          filter: [
            ...(serviceName ? [{ term: { [SERVICE_NAME]: serviceName } }] : []),
            ...(transactionType
              ? [{ term: { [TRANSACTION_TYPE]: transactionType } }]
              : []),
            ...rangeQuery(start, end),
            ...environmentQuery(environment),
            ...getDocumentTypeFilterForAggregatedTransactions(
              searchAggregatedTransactions
            ),
          ],
        },
      },
      aggs: {
        outcomes,
        timeseries: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: interval,
            extended_bounds: {
              min: start,
              max: end,
            },
          },
          aggs: { outcomes },
        },
      },
    },
  };

  const resp = await apmEventClient.search(
    'get_transaction_error_rate_chart_preview',
    params
  );

  if (!resp.aggregations) {
    return [];
  }

  return resp.aggregations.timeseries.buckets.map((bucket) => {
    return {
      x: bucket.key,
      y: calculateFailedTransactionRate(bucket.outcomes),
    };
  });
}
