import Messenger from './lib/messenger.js';
import { Mqtt } from 'azure-iot-provisioning-device-mqtt';
import { X509Security } from 'azure-iot-security-x509';
import fetch from 'node-fetch';
import getDeviceCertOpitons from './lib/util.js';
import mqtt from 'async-mqtt';
import pkg from 'azure-iot-provisioning-device';

const { ProvisioningDeviceClient } = pkg;

// async wrapper for MQTT client
let localMqtt = null;
// messenger with cloud provider (not async)
let cloudMsgr = null;
// the available system producer topics
const producerTopics = ['telemetry', 'state', 'device'];

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
async function provision() {
  // Get the Balena fleet environment variables
  const provisioningHost = process.env.PROVISIONING_HOST;
  const idScope = process.env.PROVISIONING_IDSCOPE;
  const registrationId = process.env.RESIN_DEVICE_UUID;
  const deviceCert = getDeviceCertOpitons();
  const transport = new Mqtt();
  const securityClient = new X509Security(registrationId, deviceCert);
  const deviceClient = ProvisioningDeviceClient.create(
    provisioningHost,
    idScope,
    transport,
    securityClient
  );

  try {
    const result = await deviceClient.register();
    console.log('registration succeeded');
    console.log('assigned hub = ' + result.assignedHub);
    console.log('device id = ' + result.deviceId);
    process.env.CONNECTION_STRING =
      'HostName=' +
      result.assignedHub +
      ';DeviceId=' +
      result.deviceId +
      ';x509=true';
  } catch (err) {
    console.error('error registering device: ' + err);
    updateEnvironmentVars();
  }
}

/**
 * Connects and subscribes to local MQTT topic. Retries twice if can't connect.
 *
 * If success, 'localMqtt' is not null.
 */
async function connectLocal() {
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
      await provision();
    }
    await connectLocal();
    if (localMqtt) {
      if (cloudMsgr.isSyncConnect()) {
        cloudMsgr.connectSync();
        cloudMsgr.subscribeC2D(localMqtt);
        cloudMsgr.subscribeTwinConfig(localMqtt);
      } else {
        await cloudMsgr.connect();
      }
      localMqtt.on('message', (topic, message) => {
        if (producerTopics.includes(topic)) {
          cloudMsgr.publish(topic, message);
        }
      });
    }
  } catch (e) {
    console.error(e);
  }
}

start();
