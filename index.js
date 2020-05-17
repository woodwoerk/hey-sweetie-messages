const fs = require("fs");
const path = require("path");
const puppeteer = require('puppeteer');
const _ = require('lodash')
const csvToJson = require('csvtojson');

const maxMessageLength = 250
const borderColor = 'pink'
const textColor = 'black'
const date =  new Date().toISOString().split('.')[0].replace(/:/g, '-')
const pdfName = `hey-sweetie-messages_${date}.pdf`
const pdfPath = path.join(__dirname, 'pdf', pdfName);
const pdfOptions = {
    format: 'A4',
    displayHeaderFooter: false,
    margin: {
        top: "15px",
        right: "15px",
        bottom: "15px",
        left: "15px",
    },
    path: pdfPath
}

try {
    createPDF()
} catch(e) {
    console.log(e)
}

const chunkArray = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
    arr.slice(i * size, i * size + size)
  );

async function createPDF() {
    console.log('Creating those messages...')

    const filePath = process.argv[2]
    
    if (!filePath) {
        throw new Error("A csv file wasn't specified")
    }

    const orders = await csvToJson().fromFile(filePath)
    const ordersWithPersonalisation = orders.filter(box => !!box.Variations && box.Variations.match(/^Personalisation:/))

    // Chunk orders into groups of 6, so that 6 messages are displayed per page
    const pdfPages = chunkArray(ordersWithPersonalisation, 6)

    console.log(`${ordersWithPersonalisation.length} messages found on ${pdfPages.length} pages...`)

    const html = `
        <style>
            @font-face {
                font-family: "Lemon Yellow Sun";
                src: url("data:application/x-font-opentype;charset=utf-8;base64,${
                    fs.readFileSync(path.resolve(__dirname, './fonts/DK_Lemon_Yellow_Sun.otf')).toString('base64')
                  }") format("opentype");
            }
            
            body {
                font-family: 'Lemon Yellow Sun';
                -webkit-print-color-adjust: exact;
                margin: 0;
                padding: 0;
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

        ${pdfPages.map(page => `
            <div class="page">
                ${page.map(box => {
                    const minFontSize = 1.25
                    const maxFontSize = 3

                    // Remove "Personalisation:" and replace multiple linebreaks with a single linebreak
                    const message = _.unescape(box.Variations.replace(/^Personalisation:/, '').replace(/(\r\n|\n){2,}/g, '\r\n'))
                    
                    // Count the number of line breaks to help guesstimate to message length
                    const lineBreaks = message.match(/(\r\n|\n)/g)
                    const lineBreakCount = lineBreaks ? lineBreaks.length : 0
                    const messageLength = Math.min(maxMessageLength, message.length + (15 * lineBreakCount))
                    
                    const fontSize = Math.max(
                        minFontSize,
                        Math.min(
                            ((maxMessageLength - messageLength) / maxMessageLength) * (maxFontSize - minFontSize) + minFontSize,
                            maxFontSize
                        )
                    )

                    return `
                        <div class="box">
                            <h1 style="font-size: ${fontSize}em">${message}</h1>
                        </div>
                    `
                }).join('')}
            </div>
        `).join('')}
    `

	const browser = await puppeteer.launch({
		args: ['--no-sandbox'],
		headless: true
	});

	const page = await browser.newPage();
	
	await page.goto(`data:text/html;charset=UTF-8,${html}`, {
		waitUntil: 'networkidle0'
    });
    
    await page.pdf(pdfOptions);
    
    await browser.close();

    console.log(`
     meow

    |\\---/|
    | ,_, |
     \\_\`_/-..----.
  ___/ \`   ' ,""+ \\
 (__...'   __\\    |\`.___.';
   (_,...'(_,.\`__)/'.....+
    `)

    console.log(`Done! ${pdfName} created, ship them sweeties yo!`)
}