// Turns the answer of crm-api's get_adviser_tracker_page into the data the page renders from.
// crm-api computes every number and splits the tiers, which this script shows as they came. The rest
// follows scripts/build_tracker.py (build_from_answer) rule for rule: rows, the people view, notices
// and logos. The answer comes straight from the server, so there is no copy to check and no checksum test.
(function (root) {
  'use strict';

  var STRENGTHS = ['strong', 'moderate', 'weak'];
  var PEOPLE_NOTICE = 'Banks are counted from the introducers and advisers on each deal. A deal counts for the bank where one of them works today.';
  var PEOPLE_DROPPED = 'The introducer and adviser view is not shown.';
  var VIEWS = [['mandate', 'By mandate'], ['dealPeople', 'By introducer & adviser']];
  // The tile is a square with rounded corners; the logo sits inset in a square SVG, contained.
  var TILE_UNITS = 64, TILE_INSET = 6;
  var DATA_URI = /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

  function fail(code, message) { return new Error(code + ': ' + message); }
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isString(v) { return typeof v === 'string'; }

  function fitToTile(dataUri) {
    var size = TILE_UNITS - 2 * TILE_INSET;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + TILE_UNITS + ' ' + TILE_UNITS + '">'
      + '<image href="' + dataUri + '" x="' + TILE_INSET + '" y="' + TILE_INSET + '" width="' + size + '" height="' + size
      + '" preserveAspectRatio="xMidYMid meet"/></svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  // A payload with lost characters has no whole length, and its tile stays empty.
  function decodes(dataUri) { return dataUri.split(',')[1].length % 4 === 0; }

  function cleanLogo(raw) {
    var uri = isObject(raw) ? raw.dataUri : null;
    return { dataUri: isString(uri) && DATA_URI.test(uri) && decodes(uri) ? fitToTile(uri) : null };
  }

  function count(value, where) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw fail('row_invalid', where + ' must be a non-negative integer');
    return value;
  }

  function number(value, where) {
    if (typeof value !== 'number') throw fail('row_invalid', where + ' must be a number');
    return value;
  }

  function person(value, where) {
    if (!isObject(value) || !isString(value.name)) throw fail('row_invalid', where + '.name is required');
    return { name: value.name };
  }

  function cleanMonths(months, where) {
    if (!Array.isArray(months)) throw fail('row_invalid', where + '.dealsByMonth must be a list');
    return months.map(function (entry) {
      var month = isObject(entry) ? entry.month : null;
      if (!(isString(month) && MONTH.test(month))) throw fail('row_invalid', where + '.dealsByMonth entries need a YYYY-MM month');
      return { month: month, count: count(entry.count, where + '.dealsByMonth.count') };
    });
  }

  function mailDomains(value, where) {
    if (!Array.isArray(value) || !value.every(function (v) { return isObject(v) && isString(v.domain); })) {
      throw fail('row_invalid', where + ' must be a list of objects with a domain');
    }
    return value.map(function (v) { return { domain: v.domain, company: isString(v.company) && v.company ? v.company : null }; });
  }

  function cleanRelationship(raw, where) {
    if (!isObject(raw) || STRENGTHS.indexOf(raw.strength) < 0) {
      throw fail('row_invalid', where + '.relationship.strength must be one of ' + STRENGTHS.join(', '));
    }
    var top = raw.topContact == null ? null : raw.topContact;
    var matrix = raw.matrix || [];
    if (!Array.isArray(matrix)) throw fail('row_invalid', where + '.relationship.matrix must be a list');
    var out = { strength: raw.strength };
    ['interactions', 'contacts'].forEach(function (key) {
      if (key in raw) out[key] = count(raw[key], where + '.relationship.' + key);
    });
    ['linkedDomains', 'suggestedDomains'].forEach(function (key) {
      if (key in raw) out[key] = mailDomains(raw[key], where + '.relationship.' + key);
    });
    var cells = matrix.map(function (cell) {
      if (!isObject(cell) || STRENGTHS.indexOf(cell.strength) < 0) throw fail('row_invalid', where + '.relationship.matrix entries need a strength');
      return {
        teammate: person(cell.teammate, where + '.matrix.teammate'),
        contact: person(cell.contact, where + '.matrix.contact'),
        interactions: count(cell.interactions, where + '.matrix.interactions'),
        lastInteraction: isString(cell.lastInteraction) ? cell.lastInteraction : null,
        strength: cell.strength
      };
    });
    out.topContact = top === null ? null : {
      name: person(top, where + '.topContact').name,
      interactions: count(top.interactions, where + '.topContact.interactions')
    };
    out.matrix = cells;
    return out;
  }

  function cleanRow(row, index) {
    var where = 'rows[' + index + ']';
    if (!isObject(row)) throw fail('row_invalid', where + ' must be an object');
    var adviser = row.adviser;
    if (!isObject(adviser) || !isString(adviser.name) || !adviser.name.trim()) throw fail('row_invalid', where + '.adviser.name is required');
    if (!isString(adviser.domain) || !adviser.domain) throw fail('row_invalid', where + '.adviser.domain is required');
    var fees = row.fees || [];
    if (!Array.isArray(fees) || !fees.every(isObject)) throw fail('row_invalid', where + '.fees must be a list of objects');
    return {
      adviser: {
        companyId: isString(adviser.companyId) ? adviser.companyId : null,
        name: adviser.name,
        domain: adviser.domain,
        logo: cleanLogo(adviser.logo)
      },
      dealsByMonth: cleanMonths(row.dealsByMonth, where),
      relationship: cleanRelationship(row.relationship, where),
      fees: fees.map(function (f) {
        return { currency: isString(f.currency) && f.currency ? f.currency.toUpperCase() : null, amount: number(f.amount, where + '.fees.amount') };
      }),
      feeUnavailableReason: isString(row.feeUnavailableReason) && row.feeUnavailableReason ? row.feeUnavailableReason : null,
      notesCount: count(row.notesCount === undefined ? 0 : row.notesCount, where + '.notesCount')
    };
  }

  function isDomainList(value) { return Array.isArray(value) && value.every(isString); }

  // The tiers crm-api split for every year of the window: Tier 1 and Tier 2 as lists of domains.
  function serverTiers(tiersByYear, window) {
    var tiers = {};
    for (var year = window.from; year <= window.to; year++) {
      var split = isObject(tiersByYear) ? tiersByYear[String(year)] : null;
      if (!isObject(split) || !isDomainList(split[1]) || !isDomainList(split[2])) {
        throw fail('result_invalid', 'the view has no tiers for ' + year);
      }
      tiers[String(year)] = { 1: split[1], 2: split[2] };
    }
    return tiers;
  }

  function windowMonths(window) {
    if (!(isObject(window) && Number.isInteger(window.from) && Number.isInteger(window.to) && window.from <= window.to)) {
      throw fail('result_invalid', '`window` must carry integer `from` and `to`');
    }
    var months = [];
    for (var year = window.from; year <= window.to; year++) {
      for (var month = 1; month <= 12; month++) months.push(year + '-' + (month < 10 ? '0' : '') + month);
    }
    return months;
  }

  function buildData(payload, asOf, notice) {
    if (!isObject(payload) || !Array.isArray(payload.rows)) throw fail('result_invalid', 'the result has no `rows` list');
    var window = payload.window;
    windowMonths(window);
    var rows = payload.rows.map(cleanRow);
    var tenant = isObject(payload.tenant) ? payload.tenant : {};
    var tiers = serverTiers(payload.tiersByYear, window);
    return {
      tenant: { name: isString(tenant.name) ? tenant.name : '', logo: cleanLogo(tenant.logo) },
      title: isString(payload.title) && payload.title ? payload.title : 'M&A Adviser Tracker',
      window: { from: window.from, to: window.to },
      asOf: asOf,
      notice: notice,
      tiersByYear: tiers,
      rows: rows
    };
  }

  function expandBuildView(view, tenant, title) {
    if (!isObject(view) || !Array.isArray(view.rows)) throw fail('result_invalid', 'the build view has no `rows` list');
    var months = windowMonths(view.window);
    var rows = view.rows.map(function (row, index) {
      var counts = isObject(row) ? row.monthCounts : null;
      if (!Array.isArray(counts) || counts.length !== months.length) {
        throw fail('row_invalid', 'rows[' + index + '].monthCounts must hold one count per month of the window');
      }
      var rest = Object.assign({}, row);
      delete rest.monthCounts;
      rest.dealsByMonth = months.map(function (month, i) { return { month: month, count: counts[i] }; });
      return rest;
    });
    return { tenant: tenant, title: title, window: view.window, rows: rows, tiersByYear: view.tiersByYear };
  }

  function sameWindow(a, b) { return a.from === b.from && a.to === b.to; }

  function addNotice(data, line) {
    return Object.assign({}, data, { notice: data.notice ? data.notice + ' ' + line : line });
  }

  function dropPeopleView(data, detail) {
    console.warn('people view dropped: ' + detail);
    return addNotice(data, PEOPLE_DROPPED);
  }

  function withPeople(data, payload, asOf) {
    var people;
    try { people = buildData(payload, asOf, PEOPLE_NOTICE); } catch (error) { return dropPeopleView(data, error.message); }
    if (!people.rows.length) return dropPeopleView(data, 'it has no banks');
    if (!sameWindow(people.window, data.window)) return dropPeopleView(data, 'its years differ');
    return Object.assign({}, data, {
      views: [data, people].map(function (view, i) { return Object.assign({ key: VIEWS[i][0], label: VIEWS[i][1] }, view); })
    });
  }

  function logoMap(raw) {
    if (!isObject(raw) || !Array.isArray(raw.logos)) throw fail('logos_invalid', 'the logos answer has no `logos` list');
    var byDomain = {};
    raw.logos.forEach(function (entry) {
      if (isObject(entry) && isString(entry.domain)) {
        var logo = cleanLogo(entry);
        if (logo.dataUri) byDomain[entry.domain.toLowerCase()] = logo;
      }
    });
    return { tenant: cleanLogo({ dataUri: raw.tenant }), byDomain: byDomain };
  }

  // Each missing logo is filled from the logos answer. A logo a row already carries stays.
  function withLogos(view, tenantLogo, byDomain) {
    var rows = view.rows.map(function (row) {
      var own = row.adviser.logo;
      var logo = own.dataUri ? own : (byDomain[row.adviser.domain.toLowerCase()] || own);
      return Object.assign({}, row, { adviser: Object.assign({}, row.adviser, { logo: logo }) });
    });
    var tenant = view.tenant.logo.dataUri ? view.tenant : Object.assign({}, view.tenant, { logo: tenantLogo });
    return Object.assign({}, view, { tenant: tenant, rows: rows });
  }

  function applyLogos(data, answer) {
    var map;
    try { map = logoMap(answer); } catch (error) { console.warn('logos dropped: ' + error.message); return data; }
    var out = withLogos(data, map.tenant, map.byDomain);
    if (data.views) out.views = data.views.map(function (view) { return withLogos(view, map.tenant, map.byDomain); });
    return out;
  }

  // `answer` is the `answer` of a ready page; `asOf` is a YYYY-MM-DD date.
  function buildPageData(answer, asOf, notice) {
    if (!isObject(answer)) throw fail('result_invalid', 'the page answer is not an object');
    var tenant = answer.tenant, title = answer.title;
    var data = buildData(expandBuildView(answer.mandate, tenant, title), asOf, notice === undefined ? null : notice);
    var people = answer.people;
    if (isObject(people) && 'error' in people) {
      data = dropPeopleView(data, String(people.error));
    } else if (people != null) {
      try { data = withPeople(data, expandBuildView(people, tenant, title), asOf); } catch (error) { data = dropPeopleView(data, error.message); }
    } else {
      data = dropPeopleView(data, 'the build answer has no people view');
    }
    return answer.logos != null ? applyLogos(data, answer.logos) : data;
  }

  var HEX = /^#[0-9a-fA-F]{6}$/;
  var NEUTRAL = '#6b7280';

  function monogramTile(initials, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="' + (HEX.test(color) ? color : NEUTRAL)
      + '"/><text x="32" y="32" fill="#ffffff" font-family="system-ui,sans-serif" font-size="24" font-weight="600" text-anchor="middle" dominant-baseline="central">'
      + String(initials).replace(/[&<>"'\uD800-\uDFFF]/g, '') + '</text></svg>';
    return { dataUri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
  }

  // The first and last word, as crm-api's initials() takes them, by whole characters.
  function nameInitials(name) {
    var words = String(name).trim().split(/\s+/).filter(Boolean);
    var chars = function (word) { return Array.from(word); };
    return (words.length > 1 ? chars(words[0])[0] + chars(words[words.length - 1])[0] : chars(words[0] || '?').slice(0, 2).join('')).toUpperCase();
  }

  function sentOr(logo, name) {
    var sent = isObject(logo) ? logo : {};
    return { initials: isString(sent.initials) && sent.initials ? sent.initials : nameInitials(name), color: sent.color };
  }

  // Every tile that has no logo gets the bank's monogram, and the header gets the tenant's, so no tile is blank.
  // A monogram is drawn only here: the built page and the parity tests leave an empty tile.
  function withMonograms(data, answer) {
    var byDomain = {};
    [answer.mandate, answer.people].forEach(function (view) {
      if (isObject(view) && Array.isArray(view.rows)) {
        view.rows.forEach(function (row) {
          if (isObject(row) && isObject(row.adviser) && isString(row.adviser.domain)) byDomain[row.adviser.domain.toLowerCase()] = row.adviser;
        });
      }
    });
    function fill(view) {
      var sentTenant = sentOr(isObject(answer.tenant) ? answer.tenant.logo : null, view.tenant.name);
      var tenant = view.tenant.logo.dataUri ? view.tenant
        : Object.assign({}, view.tenant, { logo: monogramTile(sentTenant.initials, sentTenant.color) });
      var rows = view.rows.map(function (row) {
        if (row.adviser.logo.dataUri) return row;
        var sent = sentOr(byDomain[row.adviser.domain.toLowerCase()], row.adviser.name);
        return Object.assign({}, row, { adviser: Object.assign({}, row.adviser, { logo: monogramTile(sent.initials, sent.color) }) });
      });
      return Object.assign({}, view, { tenant: tenant, rows: rows });
    }
    var out = fill(data);
    if (data.views) out.views = data.views.map(fill);
    return out;
  }

  var api = { buildPageData: buildPageData, withMonograms: withMonograms };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrackerPageData = api;
})(typeof window !== 'undefined' ? window : this);
