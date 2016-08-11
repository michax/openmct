/*****************************************************************************
 * Open MCT Web, Copyright (c) 2014-2015, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT Web is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT Web includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define(
    [
        './modes/FixedMode',
        './modes/FollowMode',
        './TimeConductorValidation'
    ],
    function (FixedMode, FollowMode, TimeConductorValidation) {

        function TimeConductorController($scope, timeConductor, conductorViewService, timeSystems) {

            var self = this;

            //Bind all class functions to 'this'
            Object.keys(TimeConductorController.prototype).filter(function (key) {
                return typeof TimeConductorController.prototype[key] === 'function';
            }).forEach(function (key) {
                self[key] = self[key].bind(self);
            });

            this.conductorViewService = conductorViewService;
            this.conductor = timeConductor;

            this.conductor.on('bounds', this.setBounds);
            this.conductor.on('follow', function (follow){
                $scope.followMode = follow;
            });

            // Construct the provided time system definitions
            this._timeSystems = timeSystems.map(function (timeSystemConstructor){
                return timeSystemConstructor();
            });

            this.modes = {
                'fixed': {
                    cssclass: 'icon-calendar',
                    label: 'Fixed',
                    name: 'Fixed Timespan Mode',
                    description: 'Query and explore data that falls between two fixed datetimes.'
                }
            };

            //Only show 'real-time mode' if a clock source is available
            if (this.timeSystemsForSourceType('clock').length > 0 ) {
                this.modes['realtime'] = {
                    cssclass: 'icon-clock',
                    label: 'Real-time',
                    name: 'Real-time Mode',
                    tickSourceType: 'clock',
                    description: 'Monitor real-time streaming data as it comes in. The Time Conductor and displays will automatically advance themselves based on a UTC clock.'
                };
            }

            //Only show 'real-time mode' if a clock source is available
            if (this.timeSystemsForSourceType('data').length > 0) {
                this.modes['latest'] = {
                    cssclass: 'icon-database',
                    label: 'LAD',
                    name: 'LAD Mode',
                    tickSourceType: 'data',
                    description: 'Latest Available Data mode monitors real-time streaming data as it comes in. The Time Conductor and displays will only advance when data becomes available.'
                };
            }

            this.validation = new TimeConductorValidation(this.conductor);
            this.$scope = $scope;

            /*
             Set time Conductor bounds in the form
             */
            $scope.formModel = this.conductor.bounds();

            /*
             Represents the various time system options, and the currently
             selected time system in the view. Additionally holds the
             default format from the selected time system for convenience
             of access from the template.
             */
            $scope.timeSystemModel = {};
            if (this.conductor.timeSystem()) {
                $scope.timeSystemModel.selected = this.conductor.timeSystem();
                $scope.timeSystemModel.format = this.conductor.timeSystem().formats()[0];
                $scope.timeSystemModel.deltaFormat = this.conductor.timeSystem().deltaFormat();
            }

            /*
             Represents the various modes, and the currently
             selected mode in the view
             */
            $scope.modeModel = {
                options: this.modes
            };

            var mode = conductorViewService.mode();
            if (mode) {
                $scope.modeModel.selectedKey = mode.key();
                var deltas = mode.deltas && mode.deltas();
                if (deltas) {
                    $scope.formModel.startDelta = deltas.start;
                    $scope.formModel.endDelta = deltas.end;
                }

                // Show filtered list of time systems available for the
                // current mode
                var tickSourceType = this.modes[mode.key()].tickSourceType;
                $scope.timeSystemModel.options = this.timeSystemsForSourceType(tickSourceType).map(function (t) {
                    return t.metadata;
                });
            } else {
                // Default to fixed mode
                this.setMode('fixed');
            }

            $scope.$watch('modeModel.selectedKey', this.setMode);
            $scope.$watch('timeSystem', this.setTimeSystem);

        }

        /**
         * Called when the bounds change in the time conductor. Synchronizes
         * the bounds values in the time conductor with those in the form
         * @param bounds
         */
        TimeConductorController.prototype.setBounds = function (bounds) {
            this.$scope.formModel.start = bounds.start;
            this.$scope.formModel.end = bounds.end;
            if (!this.pendingUpdate) {
                this.pendingUpdate = true;
                requestAnimationFrame(function () {
                    this.pendingUpdate = false;
                    this.$scope.$digest();
                }.bind(this));
            }
        };

        /**
         * Called when form values are changed. Synchronizes the form with
         * the time conductor
         * @param formModel
         */
        TimeConductorController.prototype.updateBoundsFromForm = function (formModel) {
            var newBounds = {
                start: formModel.start,
                end: formModel.end
            };

            if (this.conductor.validateBounds(newBounds) === true) {
                this.conductor.bounds(newBounds);
            }
        };

        /**
         * Called when the delta values in the form change. Validates and
         * sets the new deltas on the Mode.
         * @param formModel
         * @see TimeConductorMode
         */
        TimeConductorController.prototype.updateDeltasFromForm = function (formModel) {
            var mode = this.conductorViewService.mode(),
                deltas = mode.deltas();

            if (deltas !== undefined && this.validation.validateDeltas(formModel.startDelta, formModel.endDelta)) {
                //Sychronize deltas between form and mode
                mode.deltas({start: parseFloat(formModel.startDelta), end: parseFloat(formModel.endDelta)});
            }
        };

        /**
         * @private
         */
        TimeConductorController.prototype.timeSystemsForSourceType = function(type){
            if (!type) {
                return this._timeSystems;
            } else {
                return this._timeSystems.filter(function (timeSystem){
                    return timeSystem.tickSources().some(function (tickSource){
                        return tickSource.type() === type;
                    });
                });
            }
        };

        TimeConductorController.prototype.selectTickSource = function (timeSystem, sourceType) {
            return timeSystem.tickSources().filter(function (source){
                return source.type() === sourceType;
            })[0];
        };

        /**
         * Change the selected Time Conductor mode. This will call destroy
         * and initialization functions on the relevant modes, setting
         * default values for bound and deltas in the form.
         * @param newModeKey
         * @param oldModeKey
         */
        TimeConductorController.prototype.setMode = function (newModeKey, oldModeKey) {
            if (newModeKey !== oldModeKey) {
                var newMode = undefined;
                var timeSystems = [];
                var timeSystem = this.conductor.timeSystem();
                var tickSourceType = this.modes[newModeKey].tickSourceType;

                if (this.conductorViewService.mode()) {
                    this.conductorViewService.mode().destroy();
                }

                function contains(timeSystems, timeSystem) {
                    return timeSystems.find(function (t) {
                        return t.metadata.key === timeSystem.metadata.key;
                    }) !== undefined;
                }

                switch (newModeKey) {
                    case 'fixed':
                        timeSystems = this._timeSystems;
                        if (!timeSystem){
                            timeSystem = timeSystems[0];
                        }
                        newMode = new FixedMode(newModeKey, this.conductor, timeSystems);
                        break;
                    case 'realtime':
                        // Filter time systems to only those with clock tick
                        // sources
                        timeSystems = this.timeSystemsForSourceType(tickSourceType);

                        //Use current conductor time system if supported by
                        // new mode, otherwise use first available time system
                        if (!contains(timeSystems, timeSystem)) {
                            timeSystem = timeSystems[0];
                        }

                        newMode = new FollowMode(newModeKey, this.conductor, timeSystems);
                        newMode.tickSource(this.selectTickSource(timeSystem, tickSourceType));
                        break;

                    case 'latest':
                        // Filter time systems to only those with data tick
                        // sources
                        timeSystems = this.timeSystemsForSourceType(tickSourceType);

                        //Use current conductor time system if supported by
                        // new mode, otherwise use first available time system
                        if (!contains(timeSystems, timeSystem)) {
                            timeSystem = timeSystems[0];
                        }

                        newMode = new FollowMode(newModeKey, this.conductor, timeSystems);
                        newMode.tickSource(this.selectTickSource(timeSystem, tickSourceType));
                        break;
                }
                newMode.initialize();
                newMode.changeTimeSystem(timeSystem);

                this.conductorViewService.mode(newMode);

                this.$scope.modeModel.selectedKey = newModeKey;
                //Synchronize scope with time system on mode
                this.$scope.timeSystemModel.options = timeSystems.map(function (t) {
                    return t.metadata;
                });
                this.setFormFromDeltas((newMode.defaults() || {}).deltas);

                this.setTimeSystem(timeSystem);
            }
        };

        /**
         * @private
         */
        TimeConductorController.prototype.setFormFromDeltas = function (deltas) {
            /*
             * If the selected mode defines deltas, set them in the form
             */
            if (deltas !== undefined) {
                this.$scope.formModel.startDelta = deltas.start;
                this.$scope.formModel.endDelta = deltas.end;
            } else {
                this.$scope.formModel.startDelta = 0;
                this.$scope.formModel.endDelta = 0;
            }
        };

        /**
         * Allows time system to be changed by key. This supports selection
         * from the menu. Resolves a TimeSystem object and then invokes
         * TimeConductorController#setTimeSystem
         * @param key
         * @see TimeConductorController#setTimeSystem
         */
        TimeConductorController.prototype.selectTimeSystemByKey = function(key){
            var selected = this._timeSystems.find(function (timeSystem){
                return timeSystem.metadata.key === key;
            });
            this.setTimeSystem(selected);
        };

        TimeConductorController.prototype.populateFormFromTimeSystem = function (timeSystem){
            this.$scope.timeSystemModel.selected = timeSystem;
            this.$scope.timeSystemModel.format = timeSystem.formats()[0];
            this.$scope.timeSystemModel.deltaFormat = timeSystem.deltaFormat();
        };

        /**
         * Sets the selected time system. Will populate form with the default
         * bounds and deltas defined in the selected time system.
         * @param newTimeSystem
         */
        TimeConductorController.prototype.setTimeSystem = function (newTimeSystem) {
            if (newTimeSystem && newTimeSystem !== this.$scope.timeSystemModel.selected) {

                var mode = this.conductorViewService.mode();
                mode.changeTimeSystem(newTimeSystem);
                this.setFormFromDeltas((mode.defaults() || {}).deltas);

                // If current mode supports ticking, set an appropriate tick
                // source from the new time system
                if (mode.tickSource) {
                    var tickSourceType = this.modes[mode.key()].tickSourceType;
                    mode.tickSource(this.selectTickSource(newTimeSystem, tickSourceType));
                }

                this.populateFormFromTimeSystem(newTimeSystem);
            }
        };

        return TimeConductorController;
    }
);
