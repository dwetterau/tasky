const appJson = require("./app.json");

const backendEnv =
  process.env.BACKEND_ENV === "production" ? "production" : "development";
const backend = require(`./config/backend.${backendEnv}.json`);

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      ...backend,
    },
  },
};
