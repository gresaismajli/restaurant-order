const { handleApi } = require("../lib/api");

module.exports = async function handler(req, res) {
  await handleApi(req, res);
};
