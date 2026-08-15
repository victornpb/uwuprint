const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const target = process.argv[2];
const targets = {
	mac: { builder: ['--mac'] },
	win: {
		builder: ['--win', '--x64'],
		packages: ['@img/sharp-win32-x64@0.33.5'],
	},
	linux: {
		builder: ['--linux', '--x64'],
		packages: [
			'@img/sharp-linux-x64@0.33.5',
			'@img/sharp-libvips-linux-x64@1.0.4',
		],
	},
};

if (target !== 'cross' && !targets[target]) {
	throw new Error('Usage: node scripts/package.js <mac|win|linux|cross>');
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const builderCommand = path.resolve('node_modules/.bin/electron-builder');

function run(command, args) {
	execFileSync(command, args, { stdio: 'inherit' });
}

function installTargetDependencies(buildTarget) {
	if (!buildTarget.packages) {
		return;
	}

	const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'uwuprint-pack-'));
	try {
		const imgDirectory = path.resolve('node_modules/@img');
		fs.mkdirSync(imgDirectory, { recursive: true });
		for (const packageName of buildTarget.packages) {
			run(npmCommand, ['pack', packageName, '--pack-destination', tempDirectory]);
			const archive = fs.readdirSync(tempDirectory).find((file) => file.endsWith('.tgz'));
			if (!archive) {
				throw new Error(`npm pack did not produce an archive for ${packageName}`);
			}
			const packageDirectoryName = packageName.match(/^@img\/([^@]+)/)[1];
			const packageDirectory = path.join(imgDirectory, packageDirectoryName);
			fs.mkdirSync(packageDirectory, { recursive: true });
			run('tar', [
				'-xzf',
				path.join(tempDirectory, archive),
				'-C',
				packageDirectory,
				'--strip-components',
				'1',
			]);
			fs.unlinkSync(path.join(tempDirectory, archive));
		}
	} finally {
		fs.rmSync(tempDirectory, { recursive: true, force: true });
	}
}

run(npmCommand, ['run', 'build']);

const buildTargets = target === 'cross' ? ['linux', 'win'] : [target];
for (const buildTargetName of buildTargets) {
	const buildTarget = targets[buildTargetName];
	installTargetDependencies(buildTarget);
	run(builderCommand, [...buildTarget.builder, '--publish=never']);
}
