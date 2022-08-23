import Messenger from './lib/messenger.js';
import fetch from 'node-fetch';
import mqtt from 'async-mqtt';

// just for debugging with util.inspect, etc.
//import util from 'util'

// async wrapper for MQTT client
let localMqtt = null;
// messenger with cloud provider (not async)
let cloudMsgr = null;

/**
 * Forces the supervisor to update environment variables.
 */
async function updateEnvironmentVars() {
  const updateUrl = `${process.env.BALENA_SUPERVISOR_ADDRESS}/v1/update?apikey=${process.env.BALENA_SUPERVISOR_API_KEY}`;
  const updateResp = await fetch(updateUrl, {
    method: 'POST',
    body: '{ "force": true }',
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('Supervisor updated:', updateResp.status);
}

/**
 * Provision provided device to cloud.
 *
 * @return {boolean} true if provisioning successful; otherwise false.
 */
async function provision(uuid) {
  let url = process.env.PROVISION_URL;
  if (!url) {
    throw 'PROVISION_URL environment variable not defined';
  }
  console.log('Provisioning with cloud provider');

  const response = await fetch(url, {
    method: 'POST',
    body: `{ "uuid": "${uuid}", "balena_service": "${process.env.RESIN_SERVICE_NAME}" }`,
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  if (response.ok) {
    // response.status >= 200 && response.status < 300
    console.log(`Provisioned OK: ${response.status} ${text}`);
  } else {
    console.warn(`Provisioning failure: ${response.status} ${text}`);
    // If device already provisioned, Supervisor may not have updated environment
    // vars yet and thus tried to provision again. So force Supervisor to update
    // and refresh environment variables. If successful, this service will
    // not attempt to provision on the next invocation.
    const alreadyExists = text.startsWith('DeviceAlreadyExistsError');
    if (alreadyExists) {
      console.warn(
        `Device already exists on ${process.env.CLOUD_PROVIDER}; updating environment vars`
      );
      updateEnvironmentVars();
    }
  }
  return response.ok;
}

/**
 * Connects and subscribes to local MQTT topic. Retries twice if can't connect.
 *
 * If success, 'localMqtt' is not null.
 */
async function connectLocal() {
  const producerTopics = ['telemetry', 'state', 'device'];

  let count = 0;
  const maxTries = 3;
  const delay = 5;
  do {
    try {
      count++;
      if (!localMqtt) {
        localMqtt = await mqtt.connectAsync('mqtt://127.0.0.1');
        console.log('Connected to mqtt://127.0.0.1');
      }
      for (const topic of producerTopics) {
        await localMqtt.subscribe(topic, { qos: 1 });
        console.log('Subscribed to topic:', topic);
      }
      break;
    } catch (e) {
      console.warn('Cannot connect to local MQTT:', e);
      if (count < maxTries) {
        console.log(`Retry in ${delay} seconds`);
        await new Promise(r => setTimeout(r, delay * 1000));
      } else {
        console.warn(`Retries exhausted`);
        localMqtt = null; // indicates connection failed
      }
    }
  } while (count < maxTries);
}

/**
 * Runs the relay. Wraps all execution in a try/catch block.
 *
 * Initializes CLOUD_PROVIDER variable to identify the provider based on the
 * presence of provider specific variables. Alternatively, you may explicitly
 * pre-define a CLOUD_PROVIDER variable.
 */
async function start() {
  if (!cloudMsgr) {
    cloudMsgr = Messenger.createAzureMessenger();
    console.log(`Created cloud messenger: ${cloudMsgr}`);
  }

  try {
    if (cloudMsgr.isUnregistered()) {
      await provision(process.env.RESIN_DEVICE_UUID);
    } else if (cloudMsgr.isRegistrationComplete()) {
      await connectLocal();
      if (localMqtt) {
        if (cloudMsgr.isSyncConnect()) {
          cloudMsgr.connectSync();
          cloudMsgr.subscribeC2D(localMqtt);
          cloudMsgr.subscribeTwinConfig(localMqtt);
        } else {
          await cloudMsgr.connect();
        }
        localMqtt.on('message', function (topic, message) {
          cloudMsgr.publish(topic, message);
        });
      }
    } else {
      console.log('Partially registered; try again later');
    }
  } catch (e) {
    console.error(e);
  }
}

start();
