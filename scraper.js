const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const mysql = require('mysql2');
console.log('Moduł mysql2 działa poprawnie!');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: true, slowMo: 50 });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36');

    page.on('request', (request) => {
        const blockResources = ['image', 'stylesheet', 'font'];
        if (blockResources.includes(request.resourceType())) {
            request.abort();
        } else {
            request.continue();
        }
    });

    console.time('MyTimer');
    const allData = [];
    let index = 0;

    // Konfiguracja bazy danych
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'scraper_db'
    });
    

    await connection.execute(`CREATE TABLE IF NOT EXISTS firmy (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nazwa VARCHAR(255),
        telefon VARCHAR(50),
        mail VARCHAR(255),
        www VARCHAR(255),
        adres VARCHAR(255),
        forma_prawna VARCHAR(255),
        kategoria VARCHAR(255),
        kod_pkd VARCHAR(255)
    )`);

    try {
        for (let zk = 1; zk <= 2 && index < 25; zk++) {//ilość stron 
            const url = `https://aleo.com/pl/firmy/artykuly-dla-biur-i-wyposazenie-biurowe/${zk}`;//link do kategorii 
            try {
                console.log(`Przechodzę do strony: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

                const cookieButton = await page.$('button[data-accept-cookies]');
                if (cookieButton) {
                    console.log("Klikam na akceptację ciasteczek...");
                    await cookieButton.click();
                    await delay(2000);
                }
                await delay(1000);

            } catch (error) {
                console.error(`Błąd podczas ładowania strony ${url}:`, error);
                continue;
            }

            const linki = await page.evaluate(() => {
                const elements = document.querySelectorAll('.catalog-row-first-line a');
                return Array.from(elements).map(element => element.href);
            });

            if (linki.length === 0) {
                console.log(`Brak linków na stronie ${zk}`);
                continue;
            }

            for (const link of linki) {
                if (index >= 25) break;//ilość linków po zapsaniu których kod się zakończy 
                try {
                    console.log(`Przechodzę do strony: ${link}`);
                    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });

                    const cookieButtonOnPage = await page.$('button[data-accept-cookies]');
                    if (cookieButtonOnPage) {
                        console.log("Klikam na akceptację ciasteczek na stronie szczegółowej...");
                        await cookieButtonOnPage.click();
                        await delay(2000);
                    }
                    await delay(1000);

                } catch (error) {
                    console.error(`Błąd podczas ładowania strony: ${link}`, error);
                    continue;
                }

                const getData = async (selector, fallback = 'Brak') => {
                    try {
                        const element = await page.$(selector);
                        if (element) {
                            const text = await page.evaluate(el => el.textContent.trim(), element);
                            return text || fallback;
                        }
                        return fallback;
                    } catch (err) {
                        console.error(`Błąd przy pobieraniu elementu z selektora ${selector}:`, err);
                        return fallback;
                    }
                };

                const name = await getData('#company-info-section .company-name span', 'Brak');//selektor do nazwy firmy
                const tel = await getData('#company-info-section .phone span', 'Brak');//selektor do numeru tel
                const mail = await getData('#company-info-section .e-mail span', 'Brak');//selektor do maila
                await delay(2000);
                const www = await getData('#company-info-section > app-company-contact > div > div.site.ng-star-inserted > span', 'Brak');//selektor do strony internetowej
                const city = await getData('#company-header > div.company-info.ng-star-inserted > div.company-info__data > div > span', 'Brak');//selektor do adresu
                const legalForm = await page.evaluate(() => {//selektor do formy prawnej
                    const rows = document.querySelectorAll('.registry-details__row');
                    for (let row of rows) {
                    
                        const label = row.querySelector('h3');
                        
                      
                        if (label && label.innerText.includes("Forma prawna")) {
                     
                            const valueElement = row.querySelector('.registry-details__row__value');
                            if (valueElement) {
                                return valueElement.innerText.trim();
                            }
                        }
                    }
                    return 'Brak';
                });
                
                const category = await getData('#company-info-section app-company-category-strap', 'Brak');//selektor do kategorii
                const pkdCode = await getData('#company-registry-data-section .pkd-codes', 'Brak');//selektor do PKD

                allData.push([name, tel, mail, www, city, legalForm, category, pkdCode]);
                index++;
                console.log('Zapisano stronę:', index);

                // Zapis do bazy danych
                await connection.execute(
                    `INSERT INTO firmy (nazwa, telefon, mail, www, adres, forma_prawna, kategoria, kod_pkd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [name, tel, mail, www, city, legalForm, category, pkdCode]
                );
            }
        }

        if (allData.length > 0) {
            const data = [['Nazwa', 'Numer telefonu', 'Mail', 'WWW', 'Adres', 'Forma prawna', 'Kategoria', 'Kod PKD'], ...allData];
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Dane');
            XLSX.writeFile(wb, 'dane.xlsx');
            console.log('Dane zapisane w pliku dane.xlsx');
        }
    } catch (error) {
        console.error('Błąd w głównej pętli:', error);
    } finally {
        await connection.end();
        await browser.close();
    }

    console.timeEnd('MyTimer');
})();
