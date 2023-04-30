const fs = require('fs').promises;
const fse = require('fs-extra');
const fileExists = async path => !!(await fs.stat(path).catch(e => false));

const target = '.temp_custom_deps';
const main = async () => {

    if (await fileExists(target)) {
        await fs.rm(target, { recursive: true, force: true });
    }
    await fs.mkdir(target);

    const configLocation = process.env.CONFIG_LOCAION ?? './mimir-config';

    if (await fileExists(configLocation)) {
        console.log(`Copying ${configLocation} to ${target}}`)
        await fse.copy(configLocation, target);
    }
};

main()