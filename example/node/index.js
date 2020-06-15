const WebSocket = require('ws');
const schema = require('enigma.js/schemas/12.34.11.json');
const enigma = require('enigma.js');
const fs = require('fs');

const host = process.env.TEST_HOST || 'localhost';

async function verifyTable(tableData, firstFieldInRow, entireRow) {
  if (tableData.length === 0) {
    return Promise.reject(new Error('Empty table response'));
  }
  // Check if we can find one of the rows we know should be there.
  const firstRow = tableData.find((row) => row.qValue[0].qText === firstFieldInRow);
  if (!firstRow) {
    throw new Error(`Could not find row with id ${firstFieldInRow}`);
  }
  // Check if the contents of that row matches the expected.
  const firstRowAsString = firstRow.qValue.map((obj) => obj.qText).reduce((a, b) => `${a}:${b}`);
  if (firstRowAsString !== entireRow) {
    throw new Error('The test row was not as expected');
  }
  return null;
}

function printTable(tableData) {
  const tableDataAsString = tableData.map((row) => row.qValue.map((value) => value.qText).reduce((left, right) => `${left}\t${right}`)).reduce((row1, row2) => `${row1}\n${row2}`);
  console.log(tableDataAsString);
}

(async () => {
  const appId = 'reloadapp.qvf';
  // create a new session:
  const session = enigma.create({
    schema,
    url: `ws://${host}:9076/${appId}`,
    createSocket: (url) => new WebSocket(url),
  });

  const trafficLog = false;

  if (trafficLog) {
    // bind traffic events to log what is sent and received on the socket:
    session.on('traffic:sent', (data) => console.log('sent:', data));
    session.on('traffic:received', (data) => console.log('received:', data));
  }

  try {
    const global = await session.open();
    console.log('Creating/opening app');
    const app = await global.createApp(appId).then((appInfo) => global.openDoc(appInfo.qAppId)).catch(() => global.openDoc(appId));
    console.log('Creating connection');

    const connectionId = await app.createConnection({
      qType: 's3-grpc-file-connector',
      qName: 's3bucket',
      qConnectionString: '<empty>',
    });

    const script = fs.readFileSync(`${__dirname}/../script.qvs`, 'utf8');

    console.log('Setting script');
    await app.setScript(script);

    console.log('Reloading');
    let reloadFinished = false;
    const reloadPromise = app.doReload();
    const progressLoggingStopped = new Promise((resolve) => {
      const logProgress = async () => {
        const progress = await global.getProgress(reloadPromise.requestId);
        if (progress.qPersistentProgress) {
          console.log(progress.qPersistentProgress);
        }
        if (!reloadFinished) {
          setTimeout(logProgress, 500);
        } else {
          resolve();
        }
      };
      logProgress();
    });
    const reloadSuccessful = await reloadPromise;
    reloadFinished = true;
    await progressLoggingStopped;

    if (!reloadSuccessful) {
      throw new Error('Reload failed');
    }
    console.log('Removing connection before saving');
    await app.deleteConnection(connectionId);
    console.log('Removing script before saving');
    await app.setScript('');
    console.log('Saving');
    await app.doSave();

    console.log('Fetching Main Table sample');
    const tableData = await app.getTableData(-1, 50, true, 'Airports');
    printTable(tableData);
    await verifyTable(tableData, '4104', '4104:Koromiko:Picton:New Zealand:PCN:NZPN:-41.348333:173.955278:60:12:Z:Pacific/Auckland');

    console.log('Fetching Reimported Table sample');
    const tableData2 = await app.getTableData(-1, 50, true, 'ExportedAndImported');
    printTable(tableData2);
    await verifyTable(tableData2, 'Koromiko', 'Koromiko:Picton');

    console.log('Fetching Dir Table sample');
    const tableData3 = await app.getTableData(-1, 50, true, 'Files');
    printTable(tableData3);
    await verifyTable(tableData3, 'airports.csv', 'airports.csv:-:738011');
    await session.close();
    console.log('Session closed');
  } catch (err) {
    console.log('Something went wrong :(', err);
    process.exit(1);
  }
})();
