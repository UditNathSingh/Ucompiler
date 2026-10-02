const Prism = require('prismjs');
require('prismjs/components/prism-c');
const code = 'char* s = "<div>";';
const highlighted = Prism.highlight(code, Prism.languages.c, 'c');
console.log(highlighted);
