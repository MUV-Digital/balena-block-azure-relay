/**
 *
 * @returns the device cert options with properties cert, key and passphrase.
 */
export default function getDeviceCertOpitons() {
  return {
    cert: getCertFromEnv(),
    key: getPrivateKeyFromEnv(),
    passphrase: '123123',
  };
}

function getCertFromEnv() {
  let certArray = process.env.DEVICE_CERTIFICATE.split(/ /g);
  certArray.unshift('-----BEGIN CERTIFICATE-----');
  certArray.push('-----END CERTIFICATE-----');

  return certArray.join('\n');
}

function getPrivateKeyFromEnv() {
  let privateKeyArray = process.env.DEVICE_KEY.split(/ /g);
  privateKeyArray.unshift('-----BEGIN ENCRYPTED PRIVATE KEY-----');
  privateKeyArray.push('-----END ENCRYPTED PRIVATE KEY-----');

  return privateKeyArray.join('\n');
}
