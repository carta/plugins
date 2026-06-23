/*
 * scenario.js — scenario state + persistence for investor-dashboard.
 * Holds the user's "plan" inputs (per-deal reserves/exit assumptions + fund-term
 * overrides), and saves/loads them via the local server (which writes to disk).
 * No Carta/MCP access here — pure local state + same-origin API.
 */
(function (root) {
  'use strict';

  function ScenarioStore(api) {
    this.api = api;              // function(method, path, body) -> Promise(json)
    this.schemaVersion = 1;
    this.reset();
  }

  ScenarioStore.prototype.reset = function () {
    this.name = '';
    this.active = false;         // false = showing Budget; true = Forecast
    this.deals = {};             // { dealId: { followOnReserve, exitValuation, exitDate, exitMultipleOnReserve } }
    this.termOverrides = {};     // { carryPct, hurdlePct, gpCommitPct, catchUp }
    this.avgCheckSize = undefined;
  };

  ScenarioStore.prototype.toScenario = function () {
    return {
      deals: this.deals,
      termOverrides: this.termOverrides,
      avgCheckSize: this.avgCheckSize
    };
  };

  ScenarioStore.prototype.setDealInput = function (dealId, field, value) {
    if (!this.deals[dealId]) this.deals[dealId] = {};
    if (value === '' || value === null || value === undefined) {
      delete this.deals[dealId][field];
      if (Object.keys(this.deals[dealId]).length === 0) delete this.deals[dealId];
    } else {
      this.deals[dealId][field] = value;
    }
    this.active = this.hasInputs();
  };

  ScenarioStore.prototype.setTerm = function (field, value) {
    if (value === '' || value === null || value === undefined) delete this.termOverrides[field];
    else this.termOverrides[field] = value;
    this.active = this.hasInputs();
  };

  ScenarioStore.prototype.hasInputs = function () {
    if (Object.keys(this.termOverrides).length) return true;
    for (var k in this.deals) { if (Object.keys(this.deals[k]).length) return true; }
    return this.avgCheckSize !== undefined;
  };

  // ---- persistence ----
  ScenarioStore.prototype.save = function (name, fundId) {
    this.name = name || this.name || 'scenario';
    var payload = {
      schemaVersion: this.schemaVersion,
      name: this.name,
      fundId: fundId || null,
      deals: this.deals,
      termOverrides: this.termOverrides,
      avgCheckSize: this.avgCheckSize
    };
    return this.api('POST', '/api/scenario', payload);
  };

  ScenarioStore.prototype.list = function () {
    return this.api('GET', '/api/scenarios');
  };

  ScenarioStore.prototype.load = function (id, expectedFundId) {
    var self = this;
    return this.api('GET', '/api/scenario/' + encodeURIComponent(id)).then(function (obj) {
      var warning = null;
      if (obj.schemaVersion !== self.schemaVersion) {
        warning = 'Scenario was saved with a different engine version (v' + obj.schemaVersion + '); results may differ.';
      }
      if (expectedFundId && obj.fundId && obj.fundId !== expectedFundId) {
        warning = 'This scenario was saved for a different fund.';
      }
      self.reset();
      self.name = obj.name || id;
      self.deals = obj.deals || {};
      self.termOverrides = obj.termOverrides || {};
      self.avgCheckSize = obj.avgCheckSize;
      self.active = self.hasInputs();
      return { warning: warning, name: self.name };
    });
  };

  root.ScenarioStore = ScenarioStore;
})(typeof window !== 'undefined' ? window : this);
