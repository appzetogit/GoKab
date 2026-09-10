const fs = require('fs');

const indexCssPath = 'd:/appzeto/redigo/frontend/src/index.css';
const driverCssPath = 'd:/appzeto/redigo/frontend/src/modules/driver/styles/driver.css';
const landingCssPath = 'd:/appzeto/redigo/frontend/src/modules/shared/pages/LandingPage.css';

// 1. Update index.css
if (fs.existsSync(indexCssPath)) {
    let indexCss = fs.readFileSync(indexCssPath, 'utf8');

    // Update HSL shadcn variables
    indexCss = indexCss.replace(/--background:\s*0 0% 100%;/, '--background: 60 29% 98%;');
    indexCss = indexCss.replace(/--foreground:\s*220 20% 15%;/, '--foreground: 145 34% 28%;');
    indexCss = indexCss.replace(/--primary:\s*145 70% 42%;/, '--primary: 128 40% 59%;');
    indexCss = indexCss.replace(/--secondary:\s*145 40% 95%;/, '--secondary: 108 43% 85%;');
    indexCss = indexCss.replace(/--accent:\s*200 75% 50%;/, '--accent: 49 86% 63%;');
    indexCss = indexCss.replace(/--muted:\s*145 20% 96%;/, '--muted: 108 43% 85%;');
    indexCss = indexCss.replace(/--border:\s*145 20% 90%;/, '--border: 108 43% 85%;');

    // Update @theme block
    indexCss = indexCss.replace(/--color-primary:\s*#20A354;/g, '--color-primary: #6FBF7A;');
    indexCss = indexCss.replace(/--color-secondary:\s*#258cc4;/g, '--color-secondary: #CFE8C9;');
    
    // Check if my previous failed replacements left anything behind and fix them just in case
    indexCss = indexCss.replace(/--color-primary:\s*#6FBF7A;/g, '--color-primary: #6FBF7A;');

    // Update .driver-theme block inside index.css
    indexCss = indexCss.replace(/--color-primary:\s*#1C2833;/g, '--color-primary: #6FBF7A;');
    indexCss = indexCss.replace(/--color-secondary:\s*#334155;/g, '--color-secondary: #CFE8C9;');
    indexCss = indexCss.replace(/--driver-accent:\s*#FFD700;/g, '--driver-accent: #F2D34F;');

    fs.writeFileSync(indexCssPath, indexCss);
    console.log('Updated index.css');
}

// 2. Update driver.css
if (fs.existsSync(driverCssPath)) {
    let driverCss = fs.readFileSync(driverCssPath, 'utf8');

    driverCss = driverCss.replace(/--driver-primary:\s*#[0-9a-fA-F]+;/g, '--driver-primary: #6FBF7A;');
    driverCss = driverCss.replace(/--driver-primary-hover:\s*#[0-9a-fA-F]+;/g, '--driver-primary-hover: #5EAA69;');
    driverCss = driverCss.replace(/--driver-primary-light:\s*#[0-9a-fA-F]+;/g, '--driver-primary-light: #CFE8C9;');
    driverCss = driverCss.replace(/--driver-accent:\s*#[0-9a-fA-F]+;/g, '--driver-accent: #F2D34F;');

    fs.writeFileSync(driverCssPath, driverCss);
    console.log('Updated driver.css');
}

// 3. Update LandingPage.css
if (fs.existsSync(landingCssPath)) {
    let landingCss = fs.readFileSync(landingCssPath, 'utf8');

    landingCss = landingCss.replace(/--primary-yellow:\s*#[0-9a-fA-F]+;/g, '--primary-yellow: #F2D34F;');
    landingCss = landingCss.replace(/--primary-yellow-hover:\s*#[0-9a-fA-F]+;/g, '--primary-yellow-hover: #E3C13E;');

    fs.writeFileSync(landingCssPath, landingCss);
    console.log('Updated LandingPage.css');
}
