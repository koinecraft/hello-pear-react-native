// Based on https://github.com/holepunchto/hello-pear-worker v1.2.0 (+ P2P chat)

const PearRuntime = require('pear-runtime') // pear-runtime on desktop; pear-mobile on mobile
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const dir = require('bare-storage')
const crypto = require('bare-crypto')
const os = require('bare-os')
const b4a = require('b4a')
const { isBareKit } = require('which-runtime')

// mobile doesn't have the executable path (argv[0])
// and the worker entry path (argv[1]) in the workers argv‘s
// ... to reuse the same worker in all platforms this logic is needed
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || dir.persistent(), // argv[4] is undefined in mobile
  app: argv(5) // argv[5] is undefined in mobile
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const swarm = new Hyperswarm()
const chatSwarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })

const chatTopic = crypto
  .createHash('sha256')
  .update('pear-getting-started-chat:' + os.userInfo().username)
  .digest()
const chatConns = []

function writeChat(event) {
  pipe.write(JSON.stringify(event))
}

pear.updater.on('error', (err) => pipe.write('updater-error ' + err.message))

if (updaterConfig.updates !== false) {
  swarm.on('connection', (connection) => store.replicate(connection))
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

// An append on the app's drive doesn't check for an update straight away: the
// updater defers it by a random delay of up to an hour (see PearRuntimeUpdater)
// so that a released fleet doesn't hit the seeder all at once. Forward the
// delay so the app can say it is waiting rather than look inert — without it,
// a staged update is indistinguishable from a broken updater for up to an hour.
pear.updater.on('update-scheduled', (delay) => pipe.write('update-scheduled ' + delay))
pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))
pear.on('minver-required', () => pipe.write('minver-required')) // for mobile store update notification

chatSwarm.on('connection', (conn) => {
  const id = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 6)
  chatConns.push(conn)
  writeChat({ type: 'peers', count: chatConns.length })

  conn.on('data', (data) => {
    writeChat({ type: 'message', from: id, text: b4a.toString(data) })
  })

  conn.on('error', () => {})
  conn.once('close', () => {
    const index = chatConns.indexOf(conn)
    if (index !== -1) chatConns.splice(index, 1)
    writeChat({ type: 'peers', count: chatConns.length })
  })
})

void chatSwarm
  .join(chatTopic, { client: true, server: true })
  .flushed()
  .then(() => {
    writeChat({ type: 'ready' })
  })

goodbye(async () => {
  await chatSwarm.destroy()
  await swarm.destroy()
  await pear.close()
  await store.close()
})

pipe.on('data', async (data) => {
  const message = data.toString()

  if (message === 'pear:applyUpdate') {
    try {
      await pear.ready()
      await pear.updater.applyUpdate()
      pipe.write('pear:updateApplied')
    } catch (err) {
      pipe.write('pear:updateFailed ' + err.message)
    }
    return
  }

  try {
    const payload = JSON.parse(message)
    if (payload.type === 'chat:send' && typeof payload.text === 'string') {
      for (const conn of chatConns) conn.write(payload.text)
      return
    }
  } catch {
    // not JSON chat
  }

  pipe.write('unknown-message ' + message)
})

pipe.write('Hello from worker')
