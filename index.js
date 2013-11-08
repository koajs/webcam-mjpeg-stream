// Dependencies
var koa = require('koa')
var Stream = require('stream')
var http = require('http')
var fs = require('fs')
var path = require('path')
var spawn = require('child_process').spawn

// Environmental variables
var interval = 1000 * (parseFloat(process.env.SNAPSHOT_INTERVAL) || 5)
var port = parseInt(process.env.PORT, 10) || null

// Image snapshot stream
var snapshots = new Stream.Readable()
snapshots._read = function () {}
var lastSnapshot

setInterval(snapshot, interval)
snapshot()

function snapshot() {
  var snapshot = spawn('imagesnap', ['-'])
  var convert = spawn('convert', ['-', '-quality', '50', 'JPEG:-'])

  snapshot.stdout.pipe(convert.stdin)

  var buffers = []

  convert.stdout.on('data', onData)
  convert.stdout.once('end', onEnd)

  function onData(chunk) {
    buffers.push(chunk)
  }

  function onEnd() {
    lastSnapshot = Buffer.concat(buffers).toString('base64')

    snapshots.push('id: ' + Date.now() + '\n')
    snapshots.push('event: image\n')
    snapshots.push('data: ' + lastSnapshot + '\n\n')

    convert.stdout.removeListener('data', onData)
    buffers = null
  }
}

// Create the app
var app = koa()
var template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

app.use(require('koa-compress')({
  flush: require('zlib').Z_SYNC_FLUSH
}))

app.use(function* (next) {
  if (this.path !== '/stream')
    return yield next

  this.set('Content-Type', 'text/event-stream')
  this.set('Cache-Control', 'max-age=0, no-cache')
  this.set('Connection', 'keep-alive')

  var stream = this.body = new Stream.PassThrough()

  snapshots.pipe(stream)

  this.req.socket.once('close', function () {
    snapshots.unpipe(stream)
  })
})

app.use(function* (next) {
  if (this.path !== '/')
    return yield next

  this.body = template.replace('{{src}}', lastSnapshot
    ? 'data:image/jpeg;base64,' + lastSnapshot
    : ''
  )
})

// Create the server
var server = http.createServer()
server.on('request', app.callback())
server.timeout = Infinity
server.listen(port, function (err) {
  if (err)
    throw err

  console.log('Server listening on port ' + server.address().port + '.')
})