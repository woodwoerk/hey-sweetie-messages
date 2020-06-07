const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const _ = require('lodash')
const csvToJson = require('csvtojson')

const maxMessageLength = 250
const borderColor = 'pink'
const textColor = 'black'
const date = new Date().toISOString().split('.')[0].replace(/:/g, '-')

const messagesPdfName = `hey-sweetie-messages_${date}.pdf`
const postageLabelsPdfName = `hey-sweetie-address-labels_${date}.pdf`

const messagesPdfOptions = {
  format: 'A4',
  displayHeaderFooter: false,
  margin: {
    top: '15px',
    right: '15px',
    bottom: '15px',
    left: '15px',
  },
  path: path.join(__dirname, 'pdf', messagesPdfName),
}

const postageLabelsPdfOptions = {
  ...messagesPdfOptions,
  margin: {
    top: '45px',
    right: '12px',
    bottom: '45px',
    left: '12px',
  },
  path: path.join(__dirname, 'pdf', postageLabelsPdfName),
}

const style = `
<style>
  @font-face {
      font-family: "Lemon Yellow Sun";
      src: url("data:application/x-font-opentype;charset=utf-8;base64,${fs
        .readFileSync(
          path.resolve(__dirname, './fonts/DK_Lemon_Yellow_Sun.otf')
        )
        .toString('base64')}") format("opentype");
  }

  body {
      font-family: 'Lemon Yellow Sun';
      -webkit-print-color-adjust: exact;
      margin: 0;
      padding: 0;
  }

  @page {
    size: A4;
  }

  .page {
      height: 100vh;
      display: grid;
      column-gap: 30px;
      row-gap: 30px;
      grid-template-rows: repeat(3, 300px);
      grid-template-columns: 1fr 1fr;
      justify-items: stretch;
      align-items: stretch;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      page-break-after: always;
  }
</style>
`

try {
  createPDF()
} catch (e) {
  console.log(e)
}

const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  )

const createMessagesHtml = (orders) => {
  // Only use orders that have a personalised message
  orders = orders.filter((order) => !!order.message)

  // Chunk orders into groups of 6, so that 6 messages are displayed per page
  const pages = chunkArray(orders, 6)

  console.log(`${orders.length} messages found on ${pages.length} pages...`)

  const html = `
  ${style}

  <style>
    .box {
      border: 10px solid ${borderColor};
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      box-sizing: border-box;
      padding: 24px;
    }

    h1 {
      color: ${textColor};
      font-weight: normal;
      white-space: pre-line;
    }
  </style>

  ${pages
    .map(
      (page) => `
      <div class="page">
      ${page
        .map((order) => {
          const minFontSize = 1.25
          const maxFontSize = 3

          // Replace multiple linebreaks with a single linebreak
          // TODO: How do the linebreaks work in Wix and the bulk orders?
          const message = _.unescape(
            order.message.replace(/(\r\n|\n){2,}/g, '\r\n')
          )

          // Count the number of line breaks to help guesstimate to message length
          const lineBreaks = message.match(/(\r\n|\n)/g)
          const lineBreakCount = lineBreaks ? lineBreaks.length : 0
          const messageLength = Math.min(
            maxMessageLength,
            message.length + 15 * lineBreakCount
          )

          const fontSize = Math.max(
            minFontSize,
            Math.min(
              ((maxMessageLength - messageLength) / maxMessageLength) *
                (maxFontSize - minFontSize) +
                minFontSize,
              maxFontSize
            )
          )

          return `
            <div class="box">
              <h1 style="font-size: ${fontSize}em">${message}</h1>
            </div>
          `
        })
        .join('')}
      </div>
      `
    )
    .join('')}
  `

  return html
}

const createAddressLabel = (order) =>
  [
    order['name'],
    order['address1'],
    order['address2'],
    order['address3'],
    order['address4'],
    order['postcode'],
  ]
    .filter(Boolean)
    .join('\n')

// Creates a new item in the array for each order with a quantity of more than 1
const reduceMultipleQuantityOrders = (allOrders, order) => {
  const quantity = parseInt(order.quantity, 10) || 1

  return allOrders.concat(Array(quantity).fill(order))
}

const createPostageLabelsHtml = (orders) => {
  // Chunk orders into groups of 14, so that 14 labels are displayed per page
  const pages = chunkArray(orders.map(createAddressLabel), 14)

  console.log(
    `${orders.length} postage labels found on ${pages.length} pages...`
  )

  const html = `
  ${style}

  <style>
    .page {
      height: 100%;
      column-gap: 10px;
      row-gap: 0px;
      grid-template-rows: repeat(7, 1fr);
    }

    .box {
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: left;
      box-sizing: border-box;
      padding-left: 16px;
      padding-right: 16px;
    }

    h4 {
      font-family: "Segoe UI", Arial;
      color: ${textColor};
      font-weight: normal;
      white-space: pre-line;
    }
  </style>

  ${pages
    .map(
      (page) => `
      <div class="page">
      ${page
        .map((address) => {
          return `
            <div class="box">
              <h4>${address}</h4>
            </div>
          `
        })
        .join('')}
      </div>
      `
    )
    .join('')}
  `

  return html
}

const isAwaitingFulfillment = (order, origin) => {
  if (origin === 'wix') {
    return order.Fulfillment === 'notFulfilled'
  }

  if (origin === 'etsy') {
    return !order['Date Posted']
  }

  return true
}

// Check against some random fields unique to each website to figure out the service used
const getOrderOrigin = (order) => {
  if (order['Transaction ID']) {
    return 'etsy'
  }

  if (!!order['Order #']) {
    return 'wix'
  }

  return 'bulk'
}

const stripMessageHelpText = (message, origin) => {
  if (!message) {
    return undefined
  }

  if (origin === 'etsy' || origin === 'wix') {
    // Etsy and Wix both prepend the help text to the message followed by ':'
    const [helpText, ...messageParts] = message.split(':')

    return messageParts.join(':')
  }

  return message
}

// Make order data consistent regardless of whether it's from wix, etsy or the bulk csv
const formatOrder = (o) => {
  const origin = getOrderOrigin(o)

  return {
    name: o['Delivery Name'] || o['Delivery Customer'] || o.name,
    address1:
      o['Delivery Address1'] || o['Delivery Street Name&Number'] || o.address1,
    address2: o['Delivery Address2'] || o.address2,
    address3: o['Delivery City'] || o['Delivery City'] || o.address3,
    address4: o['Delivery State'] || o.address4,
    postcode: o['Delivery Zipcode'] || o['Delivery Zip Code'] || o.postcode,
    message: stripMessageHelpText(
      o.Variations || o["Item's Custom Text"] || o.message,
      origin
    ),
    awaitingFulfillment: isAwaitingFulfillment(o, origin),
    origin,
    quantity: o.Quantity || o.Qty || o.quantity || 1,
  }
}

async function createPDF() {
  const filePath = process.argv[2]

  if (!filePath) {
    throw new Error("A csv file wasn't specified")
  }

  console.log('')
  console.log('Creating those PDFs...')
  console.log('Using all unfilfilled orders...')

  let orders = await csvToJson().fromFile(filePath)

  orders = orders
    .map(formatOrder)
    .filter((order) => order.awaitingFulfillment)
    .reduce(reduceMultipleQuantityOrders, [])

  if (!orders.length) {
    console.log('No orders were found for printing! :(')

    return
  }

  console.log(`${orders.length} orders to print`)

  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: true,
  })

  const page = await browser.newPage()

  console.log('')

  // Create personalised messages pdf
  const messagesHtml = createMessagesHtml(orders)
  await page.setContent(messagesHtml, { waitUntil: 'networkidle0' })
  await page.pdf(messagesPdfOptions)

  console.log(`Personalised messages done! ${messagesPdfName} created`)
  console.log('')

  // Create address labels pdf
  const postageLabelsHtml = createPostageLabelsHtml(orders)
  await page.setContent(postageLabelsHtml, { waitUntil: 'networkidle0' })
  await page.pdf(postageLabelsPdfOptions)

  console.log(`Postage labels done! ${postageLabelsPdfName} created`)

  await browser.close()

  console.log(`
        _..._
      .'     '.      _
     /    .-""-/   _/ /
   .-|   /:.   |  |   |
   |  /  |:.   /.-'-./
   | .-'-;:__.'    =/
   .'=  *=|     _.='
  /   _.  |    ;
 ;-.-'|    |   |
/   | |    _|  _|
|__/'._;.  ==' ==|
         |    |   |
         /    /   /
         /-._/-._/
         |   |  |
          -._/._/
   `)

  console.log('All done, ship them sweeties yo!')
}
