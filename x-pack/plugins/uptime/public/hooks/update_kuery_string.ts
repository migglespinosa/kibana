/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { fromKueryExpression, toElasticsearchQuery } from '@kbn/es-query';
import type { IndexPattern } from '../../../../../src/plugins/data/public';
import { combineFiltersAndUserSearch, stringifyKueries } from '../../common/lib';

const getKueryString = (urlFilters: string): string => {
  let kueryString = '';
  // We are using try/catch here because this is user entered value
  // and JSON.parse and stringifyKueries can have hard time parsing
  // all possible scenarios, we can safely ignore if we can't parse them
  try {
    if (urlFilters !== '') {
      const filterMap = new Map<string, Array<string | number>>(JSON.parse(urlFilters));
      kueryString = stringifyKueries(filterMap);
    }
  } catch {
    kueryString = '';
  }
  return kueryString;
};

export const useUpdateKueryString = (
  indexPattern: IndexPattern | null,
  filterQueryString = '',
  urlFilters: string
): [string?, Error?] => {
  const kueryString = getKueryString(urlFilters);

  const combinedFilterString = combineFiltersAndUserSearch(filterQueryString, kueryString);

  let esFilters: string | undefined;
  // this try catch is necessary to evaluate user input in kuery bar,
  // this error will be actually shown in UI for user to see
  try {
    if ((filterQueryString || urlFilters) && indexPattern) {
      const ast = fromKueryExpression(combinedFilterString);

      const elasticsearchQuery = toElasticsearchQuery(ast, indexPattern);

      esFilters = JSON.stringify(elasticsearchQuery);
    }
    return [esFilters];
  } catch (err) {
    return [urlFilters, err];
  }
};
