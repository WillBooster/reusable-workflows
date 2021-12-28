module.exports={name:"plugin-auto-install",factory:()=>{let l=require("child_process"),u=require("crypto"),r=require("fs"),s=require("path");function c(n){try{let t=[s.join(n.cwd,"yarn.lock")];for(let a of n.workspaces)t.push(s.join(a.cwd,"package.json"));t.sort();let o=u.createHash("sha256");for(let a of t){let h=r.statSync(a,{throwIfNoEntry:!1});!h||o.update(h.mtimeMs.toString())}return o.digest("hex")}catch{}}function f(n){let t=e(n);return r.readFileSync(s.join(t,"hash"),"utf-8")}function i(n,t){let o=e(t);r.mkdirSync(o,{recursive:!0}),r.writeFileSync(s.join(o,"hash"),n),r.writeFileSync(s.join(o,".gitignore"),"hash"),console.info(`plugin-auto-install updated hash: ${n}`)}function e(n){return s.join(n.cwd,".yarn","plugins","plugin-auto-install")}return{hooks:{afterAllInstalled(n){try{let t=c(n);t&&i(t,n)}catch{}},async wrapScriptExecution(n,t){try{let o=c(t);try{if(o&&o===f(t))return n}catch{}console.info("plugin-auto-install detects changes in package.json and/or yarn.lock."),o&&i(o,t),l.spawnSync("yarn",["install"],{env:process.env,stdio:"inherit"})}catch{}return n}}}}};
//# sourceMappingURL=index.cjs.map
