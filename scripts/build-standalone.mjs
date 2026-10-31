import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const stripImports=src=>src.replace(/^import .*;\r?\n/gm,'').replace(/^export (const|function) /gm,'$1 ');
const index=read('index.html');
const style=read('src/style.css');
const game=stripImports(read('src/game.js'));
const agent=stripImports(read('src/agent.js'));
const strong=stripImports(read('src/strong-ai.js'));
const insights=stripImports(read('src/insights.js'));
const online=stripImports(read('src/online.js'));
const matchmaking=stripImports(read('src/matchmaking.js'));
const ui=stripImports(read('src/main.js'));
const cssTag='<link rel="stylesheet" href="./src/style.css" />';
const jsTag='<script type="module" src="./src/main.js"></script>';
if(!index.includes(cssTag)||!index.includes(jsTag)) throw Error('index.html template changed');
const bundled=index.replace(cssTag,'<style>\n'+style+'\n</style>')
 .replace(jsTag,'<script>\n'+game+'\n'+agent+'\n'+strong+'\n'+insights+'\n'+online+'\n'+matchmaking+'\n'+ui+'\n</script>')
 .replace('</title>',' · オフライン版</title>');
const output=new URL('../play.html',import.meta.url);
if(process.argv.includes('--check')) {
  if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==bundled) {
    console.error('play.html is out of date. Run npm run build:standalone');
    process.exitCode=1;
  } else console.log('Offline play.html is up to date');
} else {
  fs.writeFileSync(output,bundled,'utf8');
  console.log('Generated playable single-file: play.html');
}
