'use strict';

var util = require('util');
var worker = require('cluster').worker;
var domain = require('domain');
var config = require('./config');
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var logger = require('./lib/logger');

var app = express();
var api = require('./routes');

app.set('json spaces', 2);
app.use(bodyParser.json({ limit: 100000000 }));
app.use(function (req, res, next) {
  logger.info({ url: req.url, method: req.method, body: req.body });
  next();
});
app.use(cors);
app.use(uncaughtExceptionHandler);
app.use('/geocode-tool/api/v1', api);

app.use(express.static(__dirname + '/public', {
    index: 'index.html'
}));

app.use(errorHandler);

var host = config.get('server:hostname');
var port = config.get('server:port');
var server = app.listen(port, host, function () {
  logger.info(util.format('Node server started on %s:%d', host, port));
});

/**
 * Expressjs middleware for CORS support.
 * @function
 * @name cors
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {Function} next Express Middleware callback
 */
function cors(req, res, next) {
  if(req.headers['origin']) {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, X-Requested-With"
    });
  }
  if(req.method === 'OPTIONS') {
    res.end();
  }
  else {
    next();
  }
}

/**
 * Expressjs middleware for handling errors.
 * @function
 * @name errorHandler
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {Function} next Express Middleware callback
 */
function errorHandler(err, req, res, next) {
  logger.err(err);

  var status = Number(err.status) || 500;
  var message = err instanceof Error? {
    status: 500,
    title: 'Internal Error',
    detail: err.stack || err.toString()
  } : err;

  if(!res.headersSent) {
    res.status(status).jsonp({
      data: null,
      error: message
    });
  }
  // next(err);
}

/**
 * Expressjs middleware for handling uncaught exceptions with domain and worker restarting.
 * @function
 * @name uncaughtExceptionHandler
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {Function} next Express Middleware callback
 */
function uncaughtExceptionHandler(req, res, next) {
  var d = domain.create();

  d.add(req);
  d.add(res);

  d.on('error', function (err) {
    logger.alert(err);
    // Make sure we close down within 5 seconds.
    var timer = setTimeout(function () {
      process.exit(1);
    }, 5000);
    // But don't keep the process open just for that!
    timer.unref();
    // stop taking new requests.
    server.close();
    // Let the master know we're dead. This will trigger a "disconnect" in the cluster master,
    // and then it will fork a new worker.
    worker.disconnect();
    // Try to send an error to the request that triggered the problem.
    try {
      errorHandler(err, req, res, next);
    }
    catch (err) {
      // Oh well, not much we can do at this point.
      logger.emerg(err);
    }
  });

  d.run(next);
}
