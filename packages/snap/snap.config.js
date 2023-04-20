/* eslint-disable */
module.exports = {
  cliOptions: {
    src: "./src/index.ts",
    port: 8081
  },
  bundlerCustomizer: (bundler) => {
    // Fixes a SES issue
    bundler.ignore('@chainsafe/as-sha256');

    const through = require("through2");
    bundler.transform(function () {
      let data = "";
      return through(
        function (buf, _enc, cb) {
          data += buf;
          cb();
        },
        // eslint-disable-next-line consistent-return
        function (cb) {
          this.push("globalThis.Buffer = require('buffer/').Buffer;");
          this.push(data);
          cb();
        }
      );
    });
  }
};
