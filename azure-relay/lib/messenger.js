import azureIot from 'azure-iot-device';
import { clientFromConnectionString } from 'azure-iot-device-mqtt';

/**
 * Abstract superclass for cloud provider's IoT data messaging.
 *
 * Use Messenger.create() (defined at bottom) to create an instance of the
 * appropriate subclass.
 */
export default class Messenger {
  constructor() {}

  /**
   * Connects to the cloud providers messenging facility. Must establish
   * this connection before any messaging.
   */
  async connect() {
    throw new Error('Abstract method');
  }

  /**
   * Connects to the cloud providers messenging facility. Must establish
   * this connection before any messaging.
   *
   * This method remains for historical reasons. Prefer use of connect().
   */
  connectSync() {
    throw new Error('Abstract method');
  }

  /**
   * Provides the actual topic used to send data to the cloud provider's messaging
   * facility, based on the configured value. Allows a messenger to customize the
   * topic.
   */
  finalizeConsumerTopic(configTopic) {
    return configTopic;
  }

  /**
   * Verifies that *all* environment variables generated by provisioning actually exist.
   */
  isRegistrationComplete() {
    return false;
  }

  /**
   * Determines if this messenger use connectSync() rather than connect().
   *
   * This method will be removed when connectSync() is removed.
   */
  isSyncConnect() {
    return false;
  }

  /**
   * Verifies that *none* environment variables generated by provisioning actually exist.
   */
  isUnregistered() {
    return true;
  }

  /**
   * Publishes the message to the cloud provider on the provided topic.
   */
  publish(topic, message) {
    throw new Error('Abstract method');
  }

  /**
   * Subscribes to the cloud to device messages and publishs it to the local MQTT broker's topic 'c2d'
   */
  subscribeC2D(localMqtt) {
    throw new Error('Abstract method');
  }

  /**
   * Subscribes to the device twin configuration and publishs it to the local MQTT broker's topic 'device-twin'
   */
  subscribeTwinConfig(localMqtt) {
    throw new Error('Abstract method');
  }
}

/** Messenger for MS Azure IoT. */
class AzureMessenger extends Messenger {
  connectSync() {
    console.log(`Connecting to host ${process.env.AZURE_HUB_HOST}`);
    //console.debug("connstr:", connectionString)
    this.mqtt = clientFromConnectionString(
      `HostName=${process.env.AZURE_HUB_HOST};DeviceId=${process.env.RESIN_DEVICE_UUID};x509=true`
    );
    //console.debug("cert:", Buffer.from(process.env.AZURE_CERT, 'base64').toString())
    //console.debug("private key:", Buffer.from(process.env.AZURE_PRIVATE_KEY, 'base64').toString())
    const options = {
      cert: Buffer.from(process.env.AZURE_CERT, 'base64').toString(),
      key: Buffer.from(process.env.AZURE_PRIVATE_KEY, 'base64').toString(),
    };
    this.mqtt.setOptions(options);

    this.mqtt.open(function (err) {
      if (err) {
        console.warn('Cannot connect to Azure IoT:', err.toString());
      } else {
        console.log('Connected to Azure IoT messaging');
      }
    });
  }

  isRegistrationComplete() {
    return process.env.AZURE_PRIVATE_KEY && process.env.AZURE_CERT;
  }

  isSyncConnect() {
    return true;
  }

  isUnregistered() {
    return !process.env.AZURE_PRIVATE_KEY && !process.env.AZURE_CERT;
  }

  publish(topic, message) {
    //console.debug(`Messenger pub: ${message.toString()}`)
    let msg = new azureIot.Message(message);
    msg.contentEncoding = 'utf-8';
    msg.contentType = 'application/json';
    msg.properties.add('topic', topic);

    this.mqtt.sendEvent(msg, function (err) {
      if (err) {
        console.warn('Error sending message:', err.toString());
      }
    });
  }

  toString() {
    return 'Azure cloud messenger';
  }

  subscribeC2D(localMqtt) {
    this.mqtt.on('message', function (msg) {
      localMqtt.publish('c2d', msg.data);
    });
  }

  subscribeTwinConfig(localMqtt) {
    this.mqtt.getTwin(function (error, twin) {
      if (error) {
        console.warn('Could not get device twin configuration');
      } else {
        twin.on('properties.desired', function (delta) {
          localMqtt.publish('device-twin', JSON.stringify(delta));
        });
        localMqtt.publish(
          'device-twin',
          JSON.stringify(twin.properties.desired)
        );
      }
    });
  }
}

/**
 * Static method to create appropriate subclass
 */
Messenger.createAzureMessenger = function () {
  return new AzureMessenger();
};
