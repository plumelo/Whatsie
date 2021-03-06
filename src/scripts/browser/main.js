import {app, dialog, protocol} from 'electron';
import debug from 'debug';
import yargs from 'yargs';

import prefs from 'browser/utils/prefs';
import filePaths from 'common/utils/file-paths';
import platform from 'common/utils/platform';

// Handle uncaught exceptions
process.on('uncaughtException', function (err) {
  dialog.showErrorBox('JavaScript error in the main process', err.stack);
  logFatal(err);
});

(function () {
  // Define the CLI arguments and parse them
  const cliArgs = process.argv.slice(1, process.argv.length);
  const options = yargs(cliArgs)
    .usage('Usage: $0 [options]')
    .option('os-startup', {
      type: 'boolean',
      description: 'Flag to indicate the app is being run by the OS on startup.'
    })
    .option('portable', {
      type: 'boolean',
      description: 'Run in portable mode.'
    })
    .option('debug', {
      type: 'boolean',
      description: 'Run in debug mode.'
    })
    .option('repl', {
      type: 'boolean',
      description: 'Listen for REPL connections.'
    })
    .option('repl-port', {
      type: 'number',
      description: 'The port to listen for REPL connections on.',
      default: 3499
    })
    .option('mas', {
      type: 'boolean',
      description: 'Run in Mac App Store release mode.'
    })
    .option('version', {
      type: 'boolean',
      description: 'Print the app version.',
      alias: 'v'
    })
    .option('squirrel-install', {
      type: 'boolean',
      description: 'Squirrel.Windows flag, called when the app is installed.'
    })
    .option('squirrel-uninstall', {
      type: 'boolean',
      description: 'Squirrel.Windows flag, called after the app is updated.'
    })
    .option('squirrel-updated', {
      type: 'boolean',
      description: 'Squirrel.Windows flag, called when the app is uninstalled.'
    })
    .option('squirrel-obsolete', {
      type: 'boolean',
      description: 'Squirrel.Windows flag, called before updating to a new version.'
    })
    .option('squirrel-firstrun', {
      type: 'boolean',
      description: 'Squirrel.Windows flag, called only once after installation.'
    })
    .help('help', 'Print this help message.').alias('help', 'h')
    .epilog('Coded with <3 by ' + global.manifest.author)
    .argv;

  options.mas = options.mas || !!process.mas;
  options.portable = options.portable || !!global.manifest.portable;
  options.debug = options.debug || !!process.env.DEBUG;
  global.options = options;

  // Force-enable debug
  if (options.debug && !process.env.DEBUG) {
    process.env.DEBUG = global.manifest.name + ':*';
    debug.enable(process.env.DEBUG);
  }

  // Log args
  log('cli args parsed', JSON.stringify(options));

  // Check for debug mode
  if (options.debug) {
    log('running in debug mode');
  }

  // Check for mas mode
  if (options.mas) {
    log('running in mas mode');
  }

  // Change the userData path if in portable mode
  if (options.portable) {
    log('running in portable mode');
    const userDataPath = filePaths.getCustomUserDataPath();
    log('setting userData path', userDataPath);
    app.setPath('userData', userDataPath);
  }

  // Check for Squirrel.Windows CLI args
  if (platform.isWindows) {
    const SquirrelEvents = require('browser/components/squirrel-events').default;
    if (SquirrelEvents.check(options)) {
      log('Squirrel.Windows event detected');
      return;
    }
  }

  // Quit the app immediately if required
  if (prefs.get('launch-quit')) {
    log('launch-quit pref is true, quitting');
    prefs.unsetSync('launch-quit');
    return app.quit();
  }

  // Print the version and exit
  if (options.version) {
    console.log(`${app.getName()} ${app.getVersion()} (${global.manifest.buildNum})`);
    console.log(`Electron ${process.versions.electron}`);
    console.log(`Chromium ${process.versions.chrome}`);
    return app.quit();
  }

  // Enforce single instance
  const isDuplicateInstance = app.makeSingleInstance((argv, cwd) => {
    log('another instance tried to run argv:', argv, 'cwd:', cwd);
    if (global.application) {
      global.application.mainWindowManager.showOrCreate();
    }
  });

  // Quit if another instance is already running
  if (isDuplicateInstance) {
    console.log('Another instance of ' + global.manifest.productName + ' is already running.');
    return app.quit();
  }

  // Listen for app ready-ness
  app.on('ready', function () {
    log('ready');
    log('intercepting protocol http');
    protocol.interceptHttpProtocol('http', function (request, callback) {
      if (request.url.startsWith(global.manifest.virtualUrl)) {
        const newPath = request.url.replace(global.manifest.virtualUrl, 'file://' + app.getAppPath());
        const newPathShort = request.url.replace(global.manifest.virtualUrl, 'file://<app>');
        log('intercepted http', request.method, request.url, '=>', newPathShort);
        request.url = newPath;
        callback(request);
      }
    }, function (err) {
      if (err) {
        logFatal(err);
        log('intercepting protocol http failed, not going to launch the app anymore');
        return;
      }

      log('launching app');
      const Application = require('browser/application').default;
      global.application = new Application();
      global.application.init();
      global.ready = true;
    });
  });

  // If the REPL is enabled, launch it
  if (options.repl) {
    const repl = require('browser/utils/repl');
    repl.createServer(options.replPort);
  }
})();
