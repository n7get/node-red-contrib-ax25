"use strict";

const helper = require("node-red-node-test-helper");

helper.init(require.resolve("node-red"));

module.exports = {
  mochaHooks: {
    beforeEach(done) {
      helper.startServer(done);
    },
    afterEach(done) {
      helper.unload();
      helper.stopServer(done);
    }
  }
};
