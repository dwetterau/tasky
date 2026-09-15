const appJson = require("./app.json");

const backendEnv =
  process.env.BACKEND_ENV === "production" ? "production" : "development";
const backend = require(`./config/backend.${backendEnv}.json`);

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    ios: {
      ...appJson.expo.ios,
      infoPlist: {
        ...appJson.expo.ios?.infoPlist,
        NSBluetoothAlwaysUsageDescription: "Tasky uses Bluetooth to read your YUNMAI scale during a weigh-in.",
      },
    },
    extra: {
      ...appJson.expo.extra,
      ...backend,
    },
  },
};
