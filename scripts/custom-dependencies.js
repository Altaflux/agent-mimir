const fs = require('fs').promises;
const path = require('path');

const fileExists = async path => !!(await fs.stat(path).catch(e => false));

const main = async () => {
  const packageJsonFile = await fs.readFile('package.json', 'utf8');
  let customDependenciesFile = "{}";
  try {


    const configDirectory = process.env.CONFIG_LOCAION ?? './mimir-config';
    let customDependencies = path.join(configDirectory, 'custom-dependencies.json');

    customDependenciesFile = await fs.readFile(customDependencies, 'utf8');
  } catch (e) {
    console.log(`Custom dependencies not found`);
  }


  const packageJson = JSON.parse(packageJsonFile);
  const dependenciesJson = JSON.parse(customDependenciesFile);
  const mergedJson = {
    ...packageJson,
    dependencies: {
      ...packageJson.dependencies ?? {},
      ...dependenciesJson.dependencies ?? {}
    }
  };
  if (mergedJson.workspaces !== undefined) {
    mergedJson.workspaces = [
      ...mergedJson.workspaces.map((workspace) => {
        return "../" + workspace;
      })
    ];
  }

  let dir = '.temp_custom_deps';
  if (!fileExists(dir)) {
    await fs.mkdir(dir);
  }

  try {
    const outputFile = '.temp_custom_deps/package.json';
    await fs.writeFile(outputFile, JSON.stringify(mergedJson, null, 2));
  } catch (e) {
    console.error(`Error writing ${outputFile}:`, err);
    return;
  }
  console.log(`Successfully merged files`);

}

main();