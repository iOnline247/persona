const os = require('os');

function getOSInfo() {
	return {
		platform: os.platform(),
		release: os.release(),
		arch: os.arch(),
		cpus: os.cpus().length,
		totalmem: os.totalmem(),
		freemem: os.freemem(),
		uptime: os.uptime(),
		hostname: os.hostname(),
	};
}

// Example: print OS info as JSON
console.log(JSON.stringify(getOSInfo(), null, 2));