/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import d3 from 'd3';
import _ from 'lodash';
import $ from 'jquery';

import { Axis } from './axis';
import { VisConfig } from '../vis_config';
import { getMockUiState } from '../../../fixtures/mocks';

describe('Vislib xAxis Class Test Suite', function () {
  let mockUiState;
  let xAxis;
  let el;
  let fixture;
  const data = {
    hits: 621,
    ordered: {
      date: true,
      interval: 30000,
      max: 1408734982458,
      min: 1408734082458,
    },
    xAxisOrderedValues: [
      1408734060000,
      1408734090000,
      1408734120000,
      1408734150000,
      1408734180000,
      1408734210000,
      1408734240000,
      1408734270000,
      1408734300000,
      1408734330000,
    ],
    series: [
      {
        label: 'Count',
        values: [
          {
            x: 1408734060000,
            y: 8,
          },
          {
            x: 1408734090000,
            y: 23,
          },
          {
            x: 1408734120000,
            y: 30,
          },
          {
            x: 1408734150000,
            y: 28,
          },
          {
            x: 1408734180000,
            y: 36,
          },
          {
            x: 1408734210000,
            y: 30,
          },
          {
            x: 1408734240000,
            y: 26,
          },
          {
            x: 1408734270000,
            y: 22,
          },
          {
            x: 1408734300000,
            y: 29,
          },
          {
            x: 1408734330000,
            y: 24,
          },
        ],
      },
    ],
    xAxisFormatter: function (thing) {
      return new Date(thing);
    },
    xAxisLabel: 'Date Histogram',
    yAxisLabel: 'Count',
  };

  beforeEach(() => {
    mockUiState = getMockUiState();
    el = d3.select('body').append('div').attr('class', 'visAxis--x').style('height', '40px');

    fixture = el.append('div').attr('class', 'x-axis-div');

    const visConfig = new VisConfig(
      {
        type: 'heatmap',
      },
      data,
      mockUiState,
      $('.x-axis-div')[0],
      () => undefined
    );
    xAxis = new Axis(visConfig, {
      type: 'category',
      id: 'CategoryAxis-1',
    });
  });

  afterEach(function () {
    fixture.remove();
    el.remove();
  });

  describe('render Method', function () {
    beforeEach(function () {
      xAxis.render();
    });

    it('should append an svg to div', function () {
      expect(el.selectAll('svg').length).toBe(1);
    });

    it('should append a g element to the svg', function () {
      expect(el.selectAll('svg').select('g').length).toBe(1);
    });

    it('should append ticks with text', function () {
      expect(!!el.selectAll('svg').selectAll('.tick text')).toBe(true);
    });
  });

  describe('getScale, getDomain, getTimeDomain, and getRange Methods', function () {
    let timeScale;
    let width;
    let range;

    beforeEach(function () {
      width = $('.x-axis-div').width();
      xAxis.getAxis(width);
      timeScale = xAxis.getScale();
      range = xAxis.axisScale.getRange(width);
    });

    it('should return a function', function () {
      expect(_.isFunction(timeScale)).toBe(true);
    });

    it('should return the correct domain', function () {
      expect(_.isDate(timeScale.domain()[0])).toBe(true);
      expect(_.isDate(timeScale.domain()[1])).toBe(true);
    });

    it('should return the min and max dates', function () {
      expect(timeScale.domain()[0].toDateString()).toBe(new Date(1408734060000).toDateString());
      expect(timeScale.domain()[1].toDateString()).toBe(new Date(1408734330000).toDateString());
    });

    it('should return the correct range', function () {
      expect(range[0]).toBe(0);
      expect(range[1]).toBe(width);
    });
  });

  describe('getOrdinalDomain Method', function () {
    let ordinalScale;
    let ordinalDomain;
    let width;

    beforeEach(function () {
      width = $('.x-axis-div').width();
      xAxis.ordered = null;
      xAxis.axisConfig.ordered = null;
      xAxis.getAxis(width);
      ordinalScale = xAxis.getScale();
      ordinalDomain = ordinalScale.domain(['this', 'should', 'be', 'an', 'array']);
    });

    it('should return an ordinal scale', function () {
      expect(ordinalDomain.domain()[0]).toBe('this');
      expect(ordinalDomain.domain()[4]).toBe('array');
    });

    it('should return an array of values', function () {
      expect(Array.isArray(ordinalDomain.domain())).toBe(true);
    });
  });

  describe('getXScale Method', function () {
    let width;
    let xScale;

    beforeEach(function () {
      width = $('.x-axis-div').width();
      xAxis.getAxis(width);
      xScale = xAxis.getScale();
    });

    it('should return a function', function () {
      expect(_.isFunction(xScale)).toBe(true);
    });

    it('should return a domain', function () {
      expect(_.isDate(xScale.domain()[0])).toBe(true);
      expect(_.isDate(xScale.domain()[1])).toBe(true);
    });

    it('should return a range', function () {
      expect(xScale.range()[0]).toBe(0);
      expect(xScale.range()[1]).toBe(width);
    });
  });

  describe('getXAxis Method', function () {
    let width;

    beforeEach(function () {
      width = $('.x-axis-div').width();
      xAxis.getAxis(width);
    });

    it('should create an getScale function on the xAxis class', function () {
      expect(_.isFunction(xAxis.getScale())).toBe(true);
    });
  });

  describe('draw Method', function () {
    it('should be a function', function () {
      expect(_.isFunction(xAxis.draw())).toBe(true);
    });
  });
});
