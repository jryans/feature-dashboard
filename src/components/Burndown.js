/*
Copyright 2019 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { Component } from 'react';

import dateFormat from 'dateformat';
import { Line } from 'react-chartjs-2';

const FILL_COLORS = [
    'rgba(0, 40, 0, 0.2)',
    'rgba(40, 0, 0, 0.2)',
    'rgba(0, 0, 40, 0.2)',
    'rgba(40, 40, 0, 0.2)',
    'rgba(0, 40, 40, 0.2)',
    'rgba(40, 0, 40, 0.2)',
];

const LINE_COLORS = [
    'rgba(0, 40, 0, 0.5)',
    'rgba(40, 0, 0, 0.5)',
    'rgba(0, 0, 40, 0.5)',
    'rgba(40, 40, 0, 0.5)',
    'rgba(0, 40, 40, 0.5)',
    'rgba(40, 0, 40, 0.5)',
];

class Burndown extends Component {

    render() {
        let { issues } = this.props;

        if (issues.length === 0) {
            return (
                <div className="Burndown raised-box">
                    <h3>Loading data...</h3>
                </div>
            );
        }

        // Attempt to bucket issues by phase
        // TODO: Extract this out as a generic issue categoriser
        let label = issue => {
            let phases = issue.labels.filter(label => label.name.startsWith('phase:'));
            if (phases.length > 0) {
                return phases[0].name;
            }
            return null;
        };
        let sort = (a, b) => {
            return Number(a.split(":")[1]) - Number(b.split(":")[1]);
        };

        let headings = [...new Set(issues.filter(label).map(label))].sort(sort);
        let buckets = {};
        if (headings.length > 0) {
            headings.forEach(heading => {
                buckets[heading] = issues.filter(item => label(item) === heading);
            });
        } else {
            buckets['unphased'] = issues;
        }

        let dates = [];
        let openIssueCounts = {};
        let closedIssueDeltas = {};

        // Initialise dates array and issue count per day for all relevant dates
        // Start at from creation time of the earliest issue by default
        // Limit to one year at most
        // TODO: URL param for custom start date?
        let today = new Date();
        let tomorrow = new Date().setDate(today.getDate() + 1);
        let oneYearAgo = new Date().setFullYear(today.getFullYear() - 1);
        let displayedIssues = Object.values(buckets).reduce((array, value) => {
            return array.concat(value);
        });
        let date = new Date(
            Math.max(
                Math.min(
                    ...displayedIssues.map(issue => new Date(issue.githubIssue.created_at))
                ),
                oneYearAgo
            )
        );
        while (date < tomorrow) {
            let day = dateFormat(date, 'yyyy-mm-dd');
            dates.push(day);
            openIssueCounts[day] = {};
            closedIssueDeltas[day] = 0;
            date.setDate(date.getDate() + 1);
        }

        let datasets = [];

        // Create a dataset for each bucket
        Object.keys(buckets).forEach((bucket, index) => {
            // Initialise counts to 0 for this bucket for all dates
            Object.keys(openIssueCounts).forEach(date => {
                openIssueCounts[date][bucket] = 0;
            });

            buckets[bucket].forEach(issue => {
                let start = Math.max(0, dates.indexOf(dateFormat(issue.githubIssue.created_at, 'yyyy-mm-dd')));
                let end = issue.githubIssue.closed_at ? dates.indexOf(dateFormat(issue.githubIssue.closed_at, 'yyyy-mm-dd')) : dates.length;
                for (let n = start; n < end; n++) {
                    openIssueCounts[dates[n]][bucket] += 1;
                }
            });
            datasets.push({
                label: `Open ${bucket} issues`,
                data: dates.map(date => openIssueCounts[date][bucket]),
                lineTension: 0,
                backgroundColor: FILL_COLORS[index],
            });
        });

        // Count closed issue deltas for entire project
        issues.forEach(issue => {
            let { closed_at } = issue.githubIssue;
            if (!closed_at) {
                return;
            }
            let closedDate = dateFormat(closed_at, 'yyyy-mm-dd');
            closedIssueDeltas[closedDate] += 1;
        });

        // Look back up to 2 weeks to compute average rate per day
        let rateSamplingDays = Math.min(dates.length, 14);
        let closedIssuesOverSamplingDays = 0;
        for (let i = dates.length - rateSamplingDays; i < dates.length; i++) {
            closedIssuesOverSamplingDays += closedIssueDeltas[dates[i]];
        }
        let closeRate = closedIssuesOverSamplingDays / rateSamplingDays;

        // Attempt to project a delivery date for each bucket
        let todaysDate = dates[dates.length - 1];
        let elapsedDays = dates.length;
        let previousBucketRemainingDays = 0;
        let previousBucketFractionalDays = 0;
        Object.keys(buckets).forEach((bucket, index) => {
            let todaysIssues = openIssueCounts[todaysDate][bucket];
            let remainingDays = todaysIssues / closeRate;

            if (todaysIssues > 0 && remainingDays !== Infinity) {
                // Add additional days to the date axis for the extra days
                // needed for this bucket.
                let lastDate = dates[dates.length - 1];
                let date = new Date(lastDate);
                for (let i = 0; i < remainingDays + 1; i++) {
                    dates.push(dateFormat(date, 'yyyy-mm-dd'));
                    date.setDate(date.getDate() + 1);
                }
                let projection = [];
                for (let i = 0; i < elapsedDays; i++) {
                    projection.push(null);
                }
                // Since the lines are actually stacked, we need to use a
                // constant value for any days where a previous bucket is being
                // depleted below this one.
                for (let i = 0; i < previousBucketRemainingDays; i++) {
                    projection.push(todaysIssues);
                }
                for (let i = previousBucketFractionalDays; i < remainingDays + 1; i++) {
                    projection.push(todaysIssues - (i * closeRate));
                }
                // Store fractional days to the next date to help the next
                // bucket stack smoothly.
                previousBucketFractionalDays = Math.ceil(remainingDays) - remainingDays;

                datasets.push({
                    label: `Projected ${bucket} delivery`,
                    data: projection,
                    lineTension: 0,
                    pointRadius: 0,
                    borderColor: LINE_COLORS[index],
                    borderWidth: 2,
                    backgroundColor: FILL_COLORS[index],
                });
            }

            previousBucketRemainingDays += remainingDays;
        });

        let data = {
            labels: dates,
            datasets: datasets
        };
        let options = {
            scales: {
                yAxes: [{
                    stacked: true,
                    ticks: {
                        min: 0
                    }
                }]
            }
        };

        return (
            <div className="Burndown raised-box">
                <h3>{ this.props.labels.join(' ') }</h3>
                <Line data={ data } options={ options }/>
            </div>
        );
    }

}

export default Burndown;
