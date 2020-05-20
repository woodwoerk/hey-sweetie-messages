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
    top: '42px',
    right: '12px',
    bottom: '41px',
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
  orders = orders.filter(
    (box) => !!box.Variations && box.Variations.match(/^Personalisation:/)
  )

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
        .map((box) => {
          const minFontSize = 1.25
          const maxFontSize = 3

          // Remove "Personalisation:" and replace multiple linebreaks with a single linebreak
          const message = _.unescape(
            box.Variations.replace(/^Personalisation:/, '').replace(
              /(\r\n|\n){2,}/g,
              '\r\n'
            )
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
    order['Delivery Name'],
    order['Delivery Address1'],
    order['Delivery Address2'],
    order['Delivery City'],
    order['Delivery State'],
    order['Delivery Zipcode'],
  ]
    .filter(Boolean)
    .join('\n')

const getOrderAddresses = (orders) =>
  orders.reduce((allAddresses, order) => {
    const quantity = parseInt(order.Quantity, 10) || 1
    const label = createAddressLabel(order)

    if (quantity > 1) {
      return allAddresses.concat(Array(quantity).fill(label))
    }

    return [...allAddresses, label]
  }, [])

const createPostageLabelsHtml = (orders) => {
  // Chunk orders into groups of 14, so that 14 labels are displayed per page
  const pages = chunkArray(getOrderAddresses(orders), 14)

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

async function createPDF() {
  console.log('Creating those PDFs...')
  console.log('')

  const filePath = process.argv[2]

  if (!filePath) {
    throw new Error("A csv file wasn't specified")
  }

  const orders = await csvToJson().fromFile(filePath)

  const messagesHtml = createMessagesHtml(orders)
  const postageLabelsHtml = createPostageLabelsHtml(orders)

  const browser = await puppeteer.launch({
    args: ['--no-sandbox'],
    headless: true,
  })

  const page = await browser.newPage()

  console.log('')

  // Create personalised messages pdf
  await page.setContent(messagesHtml, { waitUntil: 'networkidle0' })
  await page.pdf(messagesPdfOptions)

  console.log(`Personalised messages done! ${messagesPdfName} created`)

  // Create address labels pdf
  await page.setContent(postageLabelsHtml, { waitUntil: 'networkidle0' })
  await page.pdf(postageLabelsPdfOptions)

  console.log(`Postage labels done! ${postageLabelsPdfName} created`)

  await browser.close()

  console.log(`
     meow

    |\\---/|
    | ,_, |
     \\_\`_/-..----.
  ___/ \`   ' ,""+ \\
 (__...'   __\\    |\`.___.';
   (_,...'(_,.\`__)/'.....+    
   `)

  console.log('All done, ship them sweeties yo!')
}
