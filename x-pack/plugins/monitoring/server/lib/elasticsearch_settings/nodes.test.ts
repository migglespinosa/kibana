/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { checkNodesSettings } from '.';
import { LegacyRequest } from '../../types';

describe('Elasticsearch Nodes Settings', () => {
  const getReq = (response?: any) => {
    return ({
      server: {
        newPlatform: {
          setup: {
            plugins: {
              cloud: {
                isCloudEnabled: false,
              },
            },
          },
        },
        plugins: {
          elasticsearch: {
            getCluster() {
              return {
                callWithRequest: () => Promise.resolve(response),
              };
            },
          },
        },
      },
    } as unknown) as LegacyRequest;
  };

  it('should return { found: false } given no response from ES', async () => {
    const mockReq = getReq();
    const result = await checkNodesSettings(mockReq);
    expect(result).toEqual({ found: false });
  });

  it('should find default collection interval reason', async () => {
    const mockReq = getReq({
      nodes: {
        node01abc: {
          settings: {
            xpack: { monitoring: { collection: { interval: -1 } } },
          },
        },
      },
    });
    const result = await checkNodesSettings(mockReq);

    expect(result).toEqual({
      found: true,
      reason: {
        context: 'nodeId: node01abc',
        data: '-1',
        property: 'xpack.monitoring.collection.interval',
      },
    });
  });

  it('should find exporters reason', async () => {
    const mockReq = getReq({
      nodes: {
        node02def: {
          settings: {
            xpack: { monitoring: { exporters: { myExporter01: {} } } },
          },
        },
      },
    });
    const result = await checkNodesSettings(mockReq);

    expect(result).toEqual({
      found: true,
      reason: {
        context: 'nodeId: node02def',
        data: 'Remote exporters indicate a possible misconfiguration: myExporter01',
        property: 'xpack.monitoring.exporters',
      },
    });
  });

  it('should find { enabled: false } reason - string case', async () => {
    const mockReq = getReq({
      nodes: {
        node02def: {
          settings: {
            xpack: { monitoring: { enabled: 'false' } },
          },
        },
      },
    });
    const result = await checkNodesSettings(mockReq);

    expect(result).toEqual({
      found: true,
      reason: {
        context: 'nodeId: node02def',
        data: 'false',
        property: 'xpack.monitoring.enabled',
      },
    });
  });

  it('should find { enabled: false } reason - bool case', async () => {
    const mockReq = getReq({
      nodes: {
        node02def: {
          settings: {
            xpack: { monitoring: { enabled: false } },
          },
        },
      },
    });
    const result = await checkNodesSettings(mockReq);

    expect(result).toEqual({
      found: true,
      reason: {
        context: 'nodeId: node02def',
        data: 'false', // data property must always be string, per propTypes
        property: 'xpack.monitoring.enabled',
      },
    });
  });
});
