// === WORLD:DEMO BEGIN ===
(function () {
  'use strict';
  // The demo bundles are real Day 147 Final exports, made by running Day 147's own harness on Day 146 bundles
  // (test/make-demo.js): Quick Build, then a Final export with the forward fields filled. They are embedded as JSON.
  //   demo  The Day 146 demo saga: two chapters on two continents, Westland and Eastland.
  //   four  Six chapters on four continents, Westland and Southmere each shared by two chapters, one chapter (The
  //         Marches) with no boss troop, and two side quests whose giver is still empty.
  var U = Kit.util;
  var DEMO = window.WORLD_DEMO = {};
  var DEMO_JSON = /*DEMO_JSON*/null;
  var FOUR_JSON = /*FOUR_JSON*/null;
  DEMO.FIXTURES = [
    { key: 'demo', label: 'Demo saga', purpose: 'Two chapters on two continents, as Day 146 and Day 147 ship it.' },
    { key: 'four', label: 'Four continents', purpose: 'Six chapters on four continents, shared continent labels, a chapter with no boss troop, and side quests.' }
  ];
  DEMO.bundle = function () { return U.clone(DEMO_JSON); };
  DEMO.fixture = function (key) {
    if (key === 'demo') return U.clone(DEMO_JSON);
    if (key === 'four') return U.clone(FOUR_JSON);
    throw new Error('Unknown fixture ' + key);
  };
})();
// === WORLD:DEMO END ===
