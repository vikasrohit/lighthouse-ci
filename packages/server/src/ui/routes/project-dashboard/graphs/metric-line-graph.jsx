/**
 * @license Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {h, Fragment} from 'preact';
import * as d3 from 'd3';
import * as _ from '@lhci/utils/src/lodash.js';

import {D3Graph, createRootSvg, findRootSvg} from '../../../components/d3-graph';
import {
  computeStatisticRerenderKey,
  updateGraphHoverElements,
  appendHoverCardHitboxElements,
} from './graph-utils';

import '../category-card.css';
import './metric-line-graph.css';
import {HoverCard} from './hover-card';
import {useState} from 'preact/hooks';
import clsx from 'clsx';
import {Nbsp} from '../../../components/nbsp';
import {getMetricScoreLevel} from '@lhci/utils/src/audit-diff-finder';

const GRAPH_MARGIN = {top: 20, right: 20, bottom: 20, left: 50};

const LEGEND_LINE_WIDTH = 20;

const STROKE_DASHARRAY_OPTIONS = [
  '', // solid
  '1, 1', // dotted
  '3, 3', // dashed
  '4, 2, 1, 1, 1, 2', // dash dot dot
];

/** @typedef {import('../project-category-summaries.jsx').StatisticWithBuild} StatisticWithBuild */

/** @typedef {{statistics: Array<StatisticWithBuild>, abbreviation: string, label: string, scoreLevels: [number, number]}} MetricLineDef */

/**
 * @typedef LineGraphData
 * @prop {Array<MetricLineDef>} metrics
 * @prop {boolean} pinned
 * @prop {string|undefined} selectedBuildId
 * @prop {number} selectedMetricIndex
 * @prop {number|undefined} [__selectedMetricIndexForTest]
 * @prop {import('preact/hooks/src').StateUpdater<string|undefined>} setSelectedBuildId
 * @prop {import('preact/hooks/src').StateUpdater<boolean>} setPinned
 * @prop {import('preact/hooks/src').StateUpdater<number>} setMetricIndex
 * @prop {string} [unit='seconds']
 * @prop {boolean} [fullWidth=false]
 */

/**
 * @param {number} graphWidth
 * @param {LineGraphData} data
 */
function buildXScale(graphWidth, data) {
  return d3
    .scaleLinear()
    .domain([0, data.metrics[0].statistics.length - 1])
    .range([0, graphWidth]);
}

/**
 * @param {HTMLElement} rootEl
 * @param {LineGraphData} data
 */
function renderLineGraph(rootEl, data) {
  const {metrics,  unit } = data;
  const {svg, masks, graphWidth, graphHeight} = createRootSvg(rootEl, GRAPH_MARGIN);

  const yMax = Math.max(...metrics.map(m => Math.max(...m.statistics.map(s => s.value))));
  console.log(unit, 'unit')
  const yMaxUnits = unit === 'seconds' ? Math.ceil((yMax * 1.1) / 1000) : Math.round(yMax * 100 * 1.1) / 100;
  console.log(yMaxUnits, 'yMaxUnits')
  const xScale = buildXScale(graphWidth, data);
  const yScale = d3.scaleLinear().domain([0, yMaxUnits]).range([graphHeight, 0]);
  const yFormat = yMax < 1 ? '.3f' : '.0f';
  const yUnit = unit === 'unitless' ? '' : 's'
  const yAxis = d3
    .axisRight(yScale)
    .ticks(Math.min(yMaxUnits > 1.0 ? yMaxUnits : 10, 6))
    .tickFormat(d => d3.format(yFormat)(d) + yUnit)
    .tickSize(0);
  /** @type {() => import('d3').Line<StatisticWithBuild>} */
  const statisticLine = d3.line;

  // The numbers on the y-axis to the right-hand side
  svg
    .append('g')
    .attr('class', 'y-axis')
    .attr('style', `transform: translateX(${-GRAPH_MARGIN.left / 2}px)`)
    .call(yAxis);

  // The tracking line for the hover/click effects
  svg
    .append('line')
    .attr('class', 'tracking-line')
    .style('transform', 'translateX(-9999px)')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', graphHeight);

  for (const metric of metrics) {
    const metricIndex = metrics.indexOf(metric);
    const lineMaskId = `metricLineMask-${_.uniqueId()}`;
    const dasharray = STROKE_DASHARRAY_OPTIONS[metricIndex % STROKE_DASHARRAY_OPTIONS.length];
    const metricLine = statisticLine()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(metric.statistics.indexOf(d)))
      .y(d => yScale(unit === 'seconds'? d.value / 1000 : d.value));

    // The plain gray line of the metric values
    svg
      .append('path')
      .datum(metric.statistics)
      .style('stroke-dasharray', dasharray)
      .attr('class', `metric-line-graph__line`)
      .attr('d', metricLine);

    // The mask of the colorful version displayed on hover
    masks
      .append('mask')
      .attr('id', lineMaskId)
      .append('path')
      .datum(metric.statistics)
      .style('stroke-dasharray', dasharray)
      .attr('class', `metric-line-mask metric-line-mask--${metricIndex}`)
      .attr('d', metricLine);

    // The mask fills to colorize the masked line
    const passThreshold = yScale(metric.scoreLevels[0] / 1000);
    const averageThreshold = yScale(metric.scoreLevels[1] / 1000);
    const scoreSectionMaskFills = [
      {type: 'pass', start: yScale(0), end: passThreshold},
      {type: 'average', start: passThreshold, end: averageThreshold},
      {type: 'fail', start: averageThreshold, end: yScale(yMaxUnits)},
    ];

    for (const scoreSectionMaskFill of scoreSectionMaskFills) {
      if (scoreSectionMaskFill.start < 0) continue;

      svg
        .append('rect')
        .attr('x', 0)
        .attr('y', scoreSectionMaskFill.end)
        .attr('width', graphWidth)
        .attr('height', scoreSectionMaskFill.start - scoreSectionMaskFill.end)
        .attr('mask', `url(#${lineMaskId})`)
        .attr('class', `metric-line-graph__mask-fill--${scoreSectionMaskFill.type}`);
    }
  }

  console.log('metrics[0].statistics', metrics[0].statistics)

  appendHoverCardHitboxElements(
    rootEl,
    GRAPH_MARGIN,
    metrics[0].statistics,
    xScale,
    stat => data.setSelectedBuildId(stat && stat.buildId),
    data.setPinned
  );

  /** @param {number} statIndex @param {number} targetValue */
  const updateMetricIndex = (statIndex, targetValue) => {
    const metricOptions = metrics.map(m => m.statistics[statIndex]);
    const metricDistances = metricOptions.map(stat =>
      stat ? Math.abs(stat.value - targetValue) : Infinity
    );
    const closestMetricIndex = metricDistances.indexOf(Math.min(...metricDistances));
    data.setMetricIndex(closestMetricIndex);
  };

  svg.selectAll('.graph-hitbox').on('mousemove', (_, i) => {
    const graphContainer = svg.node();
    if (!graphContainer) return;
    const graphY = d3.mouse(graphContainer)[1];
    const yValue = yScale.invert(graphY);
    updateMetricIndex(i, unit === 'seconds'? yValue / 1000 : yValue);
  });
}

/**
 * @param {HTMLElement} rootEl
 * @param {LineGraphData} data
 */
function updateLineGraph(rootEl, data) {
  const {graphWidth} = findRootSvg(rootEl, GRAPH_MARGIN);
  const xScale = buildXScale(graphWidth, data);

  const selectedIndex = data.metrics[0].statistics.findIndex(
    stat => stat.buildId === data.selectedBuildId
  );

  updateGraphHoverElements(
    rootEl,
    graphWidth,
    GRAPH_MARGIN.left,
    GRAPH_MARGIN.right,
    xScale,
    selectedIndex
  );

  updateHighlightedMetricLine(rootEl, data.selectedMetricIndex);
}

/** @param {HTMLElement} rootEl @param {number} metricIndex */
function updateHighlightedMetricLine(rootEl, metricIndex) {
  const currentSelection = rootEl.querySelector('.metric-line-mask--selected');
  const nextSelection = rootEl.querySelector(`.metric-line-mask--${metricIndex}`);
  if (currentSelection === nextSelection) return;

  if (currentSelection) currentSelection.classList.toggle('metric-line-mask--selected');
  if (nextSelection) nextSelection.classList.toggle('metric-line-mask--selected');
}

/** @param {StrictOmit<LineGraphData, 'setMetricIndex'>} props */
const HoverCardWithMetricValue = props => {
  const selectedMetric = props.metrics[props.selectedMetricIndex];
  const statistics = selectedMetric && selectedMetric.statistics;
  const statistic = statistics && statistics.find(s => s.buildId === props.selectedBuildId);
  const build = statistic && statistic.build;
  const unit = props.unit;

  let children = <Fragment />;
  console.log(selectedMetric, 'selectedMetric');
  console.log(statistic, 'statistic');
  console.log(unit, 'unit');
  if (selectedMetric && statistic) {
    children = (
      <div className="metric-line-graph__hover-card-data">
        <div
          className={`text--${getMetricScoreLevel(statistic.value, selectedMetric.scoreLevels)}`}
        >
          {statistic.value === -1 ? (
            <span>Not Available</span>
          ) : (
            <Fragment>
              {statistic.value.toLocaleString(undefined, {maximumFractionDigits: 3})}
              <Nbsp />
              { unit === 'seconds' ? 'ms' : '' }
            </Fragment>
          )}
        </div>
        <div>{selectedMetric.label}</div>
      </div>
    );
  }

  return (
    <HoverCard pinned={props.pinned} url={(statistic && statistic.url) || ''} build={build}>
      {children}
    </HoverCard>
  );
};

/** @param {StrictOmit<LineGraphData, 'setMetricIndex'|'selectedMetricIndex'>} props */
export const MetricLineGraph = props => {
  const firstStat = props.metrics[0].statistics[0];
  const lastStat = props.metrics[0].statistics[props.metrics[0].statistics.length - 1];
  const [selectedMetricIndex, setMetricIndex] = useState(props.__selectedMetricIndexForTest || -1);
  const fullWidthClass = props.fullWidth ? 'full-width' : '';
  const className = `metric-line-graph graph-root-el ${fullWidthClass}`;

  return (
    <div className={className} onMouseLeave={() => setMetricIndex(-1)}>
      <HoverCardWithMetricValue {...props} selectedMetricIndex={selectedMetricIndex} />
      <D3Graph
        className="metric-line-graph__graph"
        data={{...props, setMetricIndex, selectedMetricIndex}}
        render={renderLineGraph}
        update={updateLineGraph}
        computeRerenderKey={data =>
          computeStatisticRerenderKey(
            data.metrics.map(m => m.statistics).reduce((a, b) => a.concat(b))
          )
        }
        computeUpdateKey={data => `${data.selectedBuildId}-${data.selectedMetricIndex}`}
      />

      <div className="metric-line-graph__date-range">
        <div style={{marginLeft: GRAPH_MARGIN.left}}>
          {new Date(firstStat.build.runAt || '').toLocaleDateString()}
        </div>
        <div style={{flexGrow: 1}} />
        <div style={{marginRight: GRAPH_MARGIN.right}}>
          {new Date(lastStat.build.runAt || '').toLocaleDateString()}
        </div>
      </div>

      <div
        className="metric-line-graph__legend"
        style={{marginLeft: GRAPH_MARGIN.left / 2}}
        onMouseLeave={() => setMetricIndex(-1)}
      >
        {props.metrics.map((metric, i) => {
          return (
            <div key={metric.label} onMouseOver={() => setMetricIndex(i)}>
              <svg
                className="metric-line-graph__legend-line"
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                width={LEGEND_LINE_WIDTH}
                height="2"
              >
                <line
                  x1="0"
                  y1="0"
                  x2={LEGEND_LINE_WIDTH}
                  y2="0"
                  style={{
                    strokeDasharray: STROKE_DASHARRAY_OPTIONS[i % STROKE_DASHARRAY_OPTIONS.length],
                  }}
                />
              </svg>
              <div
                className={clsx('metric-line-graph__legend-label', {
                  'legend-label--highlighted': selectedMetricIndex === i,
                })}
                style={{marginLeft: LEGEND_LINE_WIDTH}}
              >
                <span>{metric.abbreviation}</span>
                {metric.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
