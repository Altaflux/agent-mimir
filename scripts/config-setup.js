const fs = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const fileExists = async path => !!(await fs.stat(path).catch(e => false));

const target = '.temp_custom_deps';
const main = async () => {

    if (await fileExists(target)) {
        await fs.rm(target, { recursive: true, force: true });
    }
    await fs.mkdir(target);

    const configLocation = process.env.CONFIG_LOCAION ?? path.join(process.env.INIT_CWD, 'mimir-config');

    if (!(await fileExists(configLocation))) {
        throw new Error(`Configuration directory not found at "${configLocation}". A mimir-config directory with mimir-cfg.js is required.`);
    }

    const configFile = path.join(configLocation, 'mimir-cfg.js');
    if (!(await fileExists(configFile))) {
        throw new Error(`Configuration file not found at "${configFile}". A mimir-cfg.js file is required.`);
    }

    console.log(`Copying ${configLocation} to ${target}}`)
    await fse.copy(configLocation, target);
};

main()
