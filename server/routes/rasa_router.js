//All Rasa specific functions and routes.
const request = require('request');
const db = require('../db/db');
const logs = require('../db/logs');
const logger = require('../util/logger');
const fs = require('fs');
var path = require('path');

module.exports = {
  getRasaNluStatus: getRasaNluStatus,
  getRasaNluVersion: getRasaNluVersion,
  trainRasaNlu: trainRasaNlu,
  modelParseRequest: modelParseRequest,
  getRasaNluEndpoint: getRasaNluEndpoint,
  unloadRasaModel: unloadRasaModel,
  loadRasaModel: loadRasaModel,
  conversationParseRequest: conversationParseRequest,
  triggerIntentRequest: triggerIntentRequest,
  restartRasaCoreConversation: restartRasaCoreConversation,
  getConversationStory: getConversationStory,
  runActionInConversation: runActionInConversation
};

function buildRequestError(errCode, errMessages, res) {
  return {
    errCode,
    errMessages,
    res
  };
}

/**
 * 工具类 api
 * -----------------------------------------------------------------
 */

function checkDirectoryExists(filePath) {
  var dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  checkDirectoryExists(dirname);
  fs.mkdirSync(dirname);
  logger.winston.info('New directory created: ' + dirname);
}

function sendOutput(http_code, res, body, headers, type) {
  if (headers) {
    res.writeHead(http_code, headers);
  } else {
    res.writeHead(http_code, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    });
  }
  if (body && body !== '') {
    if (type) {
      res.write(body, type);
    } else {
      res.write(body);
    }
  }
  res.end();
}

/**
 * Rasa系统信息相关 api
 * -----------------------------------------------------------------
 */

function getRasaNluStatus(req, res, next) {
  logger.winston.info(
    'Rasa NLU Status Request -> ' + global.rasa_endpoint + '/status'
  );
  request(global.rasa_endpoint + '/status', function(error, response, body) {
    try {
      if (body !== undefined) {
        sendOutput(200, res, body);
      } else {
        sendOutput(500, res, '{"error" : "Server Error"}');
      }
    } catch (err) {
      logger.winston.error(err);
      sendOutput(500, res, '{"error" : ' + err + '}');
    }
  });
}

function getRasaNluEndpoint(req, res, next) {
  logger.winston.info('Rasa NLU Endpoint Request');
  sendOutput(200, res, '{"url" : "' + global.rasa_endpoint + '"}');
}

function getRasaNluVersion(req, res, next) {
  logger.winston.info(
    'Rasa NLU Version Request -> ' + global.rasa_endpoint + '/version'
  );
  request(global.rasa_endpoint + '/version', function(error, response, body) {
    try {
      if (body !== undefined) {
        sendOutput(200, res, body);
      } else {
        sendOutput(500, res, '{"error" : "Server Error"}');
      }
    } catch (err) {
      logger.winston.error(err);
      sendOutput(500, res, '{"error" : ' + err + '}');
    }
  });
}

/**
 * Rasa Domain相关 api
 * -----------------------------------------------------------------
 */
function getRasaDomain() {
  logger.winston.info(
    'Rasa Domain Request -> ' + global.rasa_endpoint + '/domain'
  );

  return new Promise((resolve, reject) => {
    request(global.rasa_endpoint + '/domain', function(error, response, body) {
      try {
        if (body !== undefined) {
          resolve(body);
        } else {
          logger.winston.error('Server Error');
          reject(buildRequestError(500, 'Server Error', response));
        }
      } catch (err) {
        logger.winston.error(err);
        reject(buildRequestError(500, err, response));
      }
    });
  });
}

/**
 * Rasa模型相关 api
 * -----------------------------------------------------------------
 */

function trainRasaNlu(req, res, next) {
  var model = {};
  model.file_path = 'server/data/models/' + req.query.bot_name + '/';
  model.file_name = Math.floor(Date.now()) + '.tar.gz';

  logger.winston.info(
    'Rasa NLU Train Request -> ' + global.rasa_endpoint + '/model/train'
  );
  try {
    checkDirectoryExists(model.file_path + model.file_name);
    var stream = request(
      {
        method: 'POST',
        uri: global.rasa_endpoint + '/model/train',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      },
      function(error, response, body) {
        if (error) {
          logger.winston.error(
            'Error Occured when posting data to nlu endpoint. ' + error
          );
          sendOutput(500, res, '{"error" : ' + error + '}');
          return;
        }
        try {
          if (response.statusCode != 200) {
            logger.winston.error(
              'Error occured while training. Rasa Server Response Code : ' +
                response.statusCode
            );
            sendOutput(500, res, '{"error" : ' + body + '}');
            return;
          } else {
            model.server_file_name = response.headers['filename'];
            model.response = response;
            logger.winston.info(
              'Training Completed, Rasa Server Response Code : ' +
                response.statusCode
            );

            sendOutput(200, res, '');

            logs.logRequest(req, 'train', {
              server_response: response.headers['filename'],
              training_data: JSON.stringify(req.body)
            });
          }
        } catch (err) {
          logger.winston.error('Exception:' + err);
          sendOutput(500, res, '{"error" : ' + err + '}');
        }
      }
    ).pipe(fs.createWriteStream(model.file_path + model.file_name));

    stream.on('finish', function() {
      if (model.server_file_name) {
        db.run(
          'insert into models(model_name, comment, bot_id, local_path, server_path, server_response)' +
            'values (?,?,?,?,?,?)',
          [
            model.file_name,
            req.query.comment,
            req.query.bot_id,
            model.file_path + model.file_name,
            model.server_file_name,
            'response'
          ],
          function(err) {
            if (err) {
              logger.winston.error('Error inserting a new record: ' + err);
            } else {
              logger.winston.info('Model saved to models table');
            }
          }
        );
      }
    });
  } catch (err) {
    logger.winston.error('Exception When sending Training Data to Rasa:' + err);
  }
}

function loadRasaModel(req, res, next) {
  logger.winston.info(
    'Load Rasa Model Request -> ' + global.rasa_endpoint + '/model'
  );
  request(
    {
      method: 'PUT',
      uri: global.rasa_endpoint + '/model',
      body: JSON.stringify(req.body)
    },
    function(error, response, body) {
      if (error) {
        logger.winston.error(error);
        sendOutput(500, res, '{"error" : ' + error + '}');
      }
      try {
        if (body !== undefined) {
          logger.winston.info('Load Rasa Model Response:' + body);
          sendOutput(200, res, body);
        }
      } catch (err) {
        logger.winston.error(err);
        sendOutput(500, res, '{"error" : ' + err + '}');
      }
    }
  );
}

function unloadRasaModel(req, res, next) {
  logger.winston.info(
    'Delete Rasa Model Request -> ' + global.rasa_endpoint + '/model'
  );
  request({ method: 'DELETE', uri: global.rasa_endpoint + '/model' }, function(
    error,
    response,
    body
  ) {
    if (error) {
      logger.winston.error(error);
      sendOutput(500, res, '{"error" : ' + error + '}');
    }
    try {
      if (body !== undefined) {
        logger.winston.info('Unload Rasa Model Response:' + body);
        sendOutput(200, res, body);
      }
    } catch (err) {
      logger.winston.error(err);
      sendOutput(500, res, '{"error" : ' + err + '}');
    }
  });
}

function modelParseRequest(req, res, next) {
  logger.winston.info(
    'Routing to Model Rasa Parse Request -> ' +
      global.rasa_endpoint +
      '/model/parse'
  );
  request(
    {
      method: 'POST',
      uri: global.rasa_endpoint + '/model/parse',
      body: JSON.stringify(req.body)
    },
    function(error, response, body) {
      try {
        logger.winston.verbose('Rasa Response: ' + body);
        logs.logRequest(req, 'parse', {
          server_response: body,
          query: req.body.q
        });
        sendOutput(200, res, body);
      } catch (err) {
        logger.winston.error(err);
        sendOutput(500, res, '{"error" : ' + err + '}');
      }
    }
  );
}

/**
 * Rasa会话跟踪相关 api
 * -----------------------------------------------------------------
 */

function getConversationStory(req, res, next) {
  try {
    logger.winston.info(
      'Routing to Model Rasa Story Request -> ' +
        global.rasa_endpoint +
        '/conversations/' +
        req.query.conversation_id +
        '/story'
    );
    request(
      {
        method: 'GET',
        uri:
          global.rasa_endpoint +
          '/conversations/' +
          req.query.conversation_id +
          '/story'
      },
      function(err, response, body) {
        try {
          logger.winston.verbose(
            'Rasa Response: ' + body.substring(1, 200) + ' ... '
          );
          logs.logRequest(req, 'parse', {
            server_response: body,
            query: req.body.q
          });
          updateStory(req.query.conversation_id, body);
          sendOutput(200, res, body, { 'Content-Type': 'plain/text' }, '');
        } catch (err) {
          logger.winston.error(err);
          sendOutput(500, res, '{"error" : ' + err + '}');
        }
      }
    );
  } catch (err) {
    logger.winston.error(err);
  }
}

function updateStory(conversation_id, story) {
  db.run(
    'update conversations set story = ? where conversation_id = ?',
    [story, conversation_id],
    function(err) {
      if (err) {
        logger.winston.info('Error updating the record');
      } else {
        logger.winston.info('Updated story');
      }
    }
  );
}

function updateConversation(conversation_id, conversation) {
  //Update the DB with the latest results
  db.run(
    'update conversations set conversation = ? where conversation_id = ?',
    [conversation, conversation_id],
    function(err) {
      if (err) {
        logger.winston.error('Error updating the record');
      } else {
        logger.winston.info('Updated conversation');
      }
    }
  );
}

async function conversationParseRequest(req, res, next) {
  try {
    logger.winston.info(
      'Routing to Model Rasa Parse Request -> ' +
        global.rasa_endpoint +
        '/conversations/' +
        req.body.conversation_id +
        '/messages'
    );
    request(
      {
        method: 'POST',
        uri:
          global.rasa_endpoint +
          '/conversations/' +
          req.body.conversation_id +
          '/messages',
        body: JSON.stringify(req.body)
      },
      function(err, response, body) {
        try {
          logger.winston.verbose('Rasa Response: ' + body + ' ... ');
          logs.logRequest(req, 'parse', {
            server_response: body,
            query: req.body.q
          });

          updateConversation(req.body.conversation_id, body);
          sendOutput(200, res, body);
        } catch (err) {
          logger.winston.error(err);
          sendOutput(500, res, '{"error" : ' + err + '}');
        }
      }
    );
  } catch (err) {
    logger.winston.error(err);
  }
}

/**
 * trigger intent
 * @param {*} conversation_id 
 * @param {*} intentName 
 */
function triggerIntent(conversation_id, intentName) {
  logger.winston.info(
    'Routing to trigger intent -> ' +
      global.rasa_endpoint +
      '/conversations/' +
      conversation_id +
      '/trigger_intent'
  );

  return new Promise((resolve, reject) => {
    request(
      {
        method: 'POST',
        uri: global.rasa_endpoint +
        '/conversations/' +
        conversation_id +
        '/trigger_intent',
        body: JSON.stringify({
          name: intentName
        })
      },
      function(error, response, body) {
        try {
          if (body !== undefined) {
            updateConversation(conversation_id, body);
            resolve(body);
          } else {
            logger.winston.error('Server Error');
            reject(buildRequestError(500, 'Server Error', response));
          }
        } catch (err) {
          logger.winston.error(err);
          reject(buildRequestError(500, err, response));
        }
      }
    );
  });
}

async function triggerIntentRequest(req, res, next) {
  try {
    const body = await triggerIntent(req.body.conversation_id, req.body.intentName);
    sendOutput(200, res, body);
  } catch (error) {
    sendOutput(500, 'Server Error', error);
  }
}

/**
 * conversation predict
 * @param {*} conversation_id 
 */
function conversationPredict(conversation_id) {
  logger.winston.info(
    'Routing to conversation predict -> ' +
      global.rasa_endpoint +
      '/conversations/' +
      conversation_id +
      '/predict'
  );

  return new Promise((resolve, reject) => {
    request(
      global.rasa_endpoint +
        '/conversations/' +
        req.body.conversation_id +
        '/predict',
      function(error, response, predict_body) {
        try {
          if (body !== undefined) {
            updateConversation(conversation_id, predict_body.tracker);
            resolve(body);
          } else {
            logger.winston.error('Server Error');
            reject(buildRequestError(500, 'Server Error', response));
          }
        } catch (err) {
          logger.winston.error(err);
          reject(buildRequestError(500, err, response));
        }
      }
    );
  });
}

function restartRasaCoreConversation(req, res, next) {
  logger.winston.info(
    'Rasa Core Restart Request -> ' +
      global.rasa_endpoint +
      '/conversations/' +
      req.body.conversation_id +
      '/tracker/events'
  );
  try {
    var body = JSON.stringify({ event: 'restart' });
    request(
      {
        method: 'POST',
        uri:
          global.rasa_endpoint +
          '/conversations/' +
          req.body.conversation_id +
          '/tracker/events',
        body: body
      },
      function(err, response, body) {
        if (err) {
          logger.winston.error(err);
          sendOutput(500, res, '{"error" : "Exception caught !!"}');
          return;
        }
        logger.winston.verbose('Restart Response' + JSON.stringify(body));
        updateConversation(req.body.conversation_id, body);
        sendOutput(200, res, body);
      }
    );
  } catch (err) {
    logger.winston.error(err);
    sendOutput(500, res, '{"error" : "Exception caught !!"}');
    return;
  }
}

/**
 * Rasa Action服务相关 api
 * -----------------------------------------------------------------
 */
async function runActionInConversation(req, res, next) {
  logger.winston.info(
    'Rasa Core Run Action Request -> ' +
      global.rasa_action_endpoint +
      '/webhook/'
  );
  try {
    const domain = JSON.parse(await getRasaDomain());
    const body = JSON.stringify({
      next_action: req.body.action,
      sender_id: String(req.body.conversation_id),
      tracker: req.body.tracker,
      domain
    });
    request(
      {
        method: 'POST',
        uri: global.rasa_action_endpoint + '/webhook/',
        body
      },
      function(err, response, execute_body) {
        if (err) {
          logger.winston.error(err);
          sendOutput(500, res, '{"error" : "Exception caught !!"}');
          return;
        }
        logger.winston.verbose(
          'Run Action Response' + JSON.stringify(execute_body)
        );
        sendOutput(200, res, execute_body);
      }
    );
  } catch (err) {
    logger.winston.error(err);
    sendOutput(500, res, '{"error" : "Exception caught !!"}');
    return;
  }
}
