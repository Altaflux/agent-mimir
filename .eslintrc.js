module.exports = {
  root: true,
  // This tells ESLint to load the config from the package `eslint-config-custom`
  rules: {
   // "@typescript-eslint/no-floating-promises": ["error"]
  },
  extends: ["custom"],
  settings: {
    next: {
      rootDir: ["apps/*/"],
    },
  },
};
