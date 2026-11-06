/**
 * Finds calls in server code whose promise nobody waits for.
 * Находит вызовы в коде сервера, результат которых никто не ждёт
 *
 * A write the server starts without waiting outlives the response. In tests it
 * collides with the next test's cleanup (`deadlock detected`, a red first run
 * of the gate, a server left undeployed until the rerun); in production a
 * deploy can lose it. The guard, unit/unawaited-calls-guard.test.js, compares
 * what this module finds with unawaitedCallsInventory.json, so that a new such
 * call reds the pull request that added it instead of somebody else's run.
 *
 * Reads source only, nothing is executed. Reported shapes:
 *   а  save();                             bare statement
 *   б  save().catch(log);                  then/catch/finally as a statement
 *   в  (async () => { ... })();            async immediately-invoked function
 *   г  Promise.allSettled([save()]);       combinator nobody awaits
 *   д  void save();
 *   е  items.forEach(async (i) => ...);    async callback nobody awaits, also
 *      items.forEach((i) => save(i));      a promise returned into a callback
 *   ж  const p = save();                   kept in a variable, never awaited;
 *                                          stored in a Set/Map only also counts
 * Inside catch and finally the same shapes are found the same way.
 *
 * Does not see: calls through parameters and object fields it cannot follow
 * (`client.query` on a local name is the exception), results of factories, dynamic
 * names (`obj[key]()`), a promise handed to a helper (the helper is assumed to own
 * it). A library call counts as async only if it is listed in isLibraryCallAsync.
 * So green is not a proof that no such call exists; a then/catch/finally chain
 * dropped as a statement is seen whatever it hangs on.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, posix } from 'path';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import t from '@babel/types';

const traverse = traverseModule.default;

const CHAIN_METHODS = new Set(['then', 'catch', 'finally']);
const COMBINATORS = new Set(['all', 'allSettled', 'race', 'any']);
const TIMERS = new Set(['setInterval', 'setTimeout', 'setImmediate']);
const EVENT_METHODS = new Set(['on', 'once', 'addListener']);
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'param', 'route']);
const STORING_METHODS = new Set(['add', 'delete', 'set']);
const REDIS_COMMANDS = new Set([
  'get', 'set', 'del', 'setEx', 'setex', 'incr', 'incrBy', 'decr', 'expire', 'ttl', 'pTTL', 'exists',
  'keys', 'scan', 'hGet', 'hSet', 'hGetAll', 'hIncrBy', 'hDel', 'lPush', 'rPush', 'lRange', 'sAdd',
  'sMembers', 'zAdd', 'zRange', 'publish', 'connect', 'quit', 'disconnect', 'flushAll', 'eval',
  'evalSha', 'mGet', 'unlink', 'ping', 'getDel', 'incrByFloat',
]);
const FS_CALLBACK_FUNCTIONS = new Set([
  'unlink', 'writeFile', 'readFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'appendFile', 'stat',
  'access', 'readdir',
]);
const CALLBACK_RESULT_COLLECTED = /(^|\.)(map|flatMap|reduce|filter|find|some|every|sort|asyncHandler|inTransaction|executeInTransaction|withTransaction|race|all|allSettled)$/;
const REASON_PLACEHOLDER = 'ЗАМЕНИ: почему ждать нельзя';

/** Call text without arguments: stays the same when the arguments are edited. */
function shape(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isThisExpression(node)) return 'this';
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const property = node.computed ? '[]' : (node.property.name ?? node.property.value ?? '?');
    return `${shape(node.object)}.${property}`;
  }
  if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) return `${shape(node.callee)}()`;
  if (t.isFunction(node)) return node.async ? 'async IIFE' : 'IIFE';
  return `<${node.type}>`;
}

function keyName(node) {
  return node.key.name ?? node.key.value ?? '?';
}

/** The name of a function, with no line number in it: lines move, keys must not. */
function functionName(path, classes) {
  const { node, parent } = path;
  if (node.id?.name) return node.id.name;
  if (t.isClassMethod(node)) {
    const owner = classes.get(path.parentPath.parent);
    return `${owner ? `${owner.name}.` : ''}${keyName(node)}`;
  }
  if (t.isObjectMethod(node)) return keyName(node);
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) return parent.id.name;
  if (t.isObjectProperty(parent)) return keyName(parent);
  if (t.isAssignmentExpression(parent)) return shape(parent.left);
  if (t.isAssignmentPattern(parent) && t.isIdentifier(parent.left)) return parent.left.name;
  if (t.isCallExpression(parent)) {
    // `const handler = asyncHandler(async (req, res) => …)` is handler.
    const holder = path.parentPath.parent;
    if (t.isIdentifier(parent.callee)) {
      if (t.isVariableDeclarator(holder) && t.isIdentifier(holder.id)) return holder.id.name;
      if (t.isObjectProperty(holder)) return keyName(holder);
    }
    // A route or an event names its callback: a new route above it moves nothing.
    const [first] = parent.arguments;
    const isNamedByFirstArgument = t.isMemberExpression(parent.callee) && !parent.callee.computed
      && (ROUTE_METHODS.has(parent.callee.property.name) || EVENT_METHODS.has(parent.callee.property.name))
      && t.isStringLiteral(first);
    return isNamedByFirstArgument ? `cb(${shape(parent.callee)} '${first.value}')` : `cb(${shape(parent.callee)})`;
  }
  return 'anon';
}

function stripAwait(node) {
  let current = node;
  while (current && t.isAwaitExpression(current)) current = current.argument;
  return current;
}

const isAnyCall = (node) => t.isCallExpression(node) || t.isOptionalCallExpression(node);
const isAnyMember = (node) => t.isMemberExpression(node) || t.isOptionalMemberExpression(node);

function isChainCall(node) {
  return isAnyCall(node) && isAnyMember(node.callee)
    && !node.callee.computed && CHAIN_METHODS.has(node.callee.property.name);
}

function isPromiseCombinator(node) {
  return t.isMemberExpression(node) && t.isIdentifier(node.object, { name: 'Promise' })
    && COMBINATORS.has(node.property.name);
}

/** Whether a call to a library resolved to `desc` returns a promise. */
function isLibraryCallAsync(desc, lastArgumentIsFunction) {
  if (/multi\(\)/.test(desc)) return /\.exec$/.test(desc);
  const parts = desc.replace(/\(\)/g, '').split('.');
  const module = parts[0].replace(/^node:/, '');
  const last = parts[parts.length - 1];
  // A pg client handed around by name: getClient(), a transaction's parameter.
  if (/^local:/.test(module) && last === 'query') return true;
  if (/^config\/database/.test(module)) return ['query', 'connect', 'end'].includes(last);
  if (/^config\/redis/.test(module)) return REDIS_COMMANDS.has(last);
  if (/^cloudinary/.test(module) || /^config\/cloudinary/.test(module)) {
    return parts.includes('uploader') || parts.includes('api');
  }
  if (/^resend/.test(module)) return last === 'send';
  if (/firebaseAdmin|firebase-admin/.test(module)) return /^send|subscribe|unsubscribe/.test(last);
  if (/^fs\/promises/.test(module) || /^fs#promises/.test(module)) return true;
  if (/^fs#/.test(module) || module === 'fs') {
    if (parts.includes('promises')) return true;
    return !/Sync$/.test(last) && lastArgumentIsFunction && FS_CALLBACK_FUNCTIONS.has(last);
  }
  if (/^argon2/.test(module)) return ['hash', 'verify'].includes(last);
  if (/^google-auth-library/.test(module)) return ['verifyIdToken', 'getToken', 'getTokenInfo'].includes(last);
  if (/^pdf-parse/.test(module)) return parts.length === 1 || last === 'default';
  return module === 'global:fetch';
}

/**
 * Where the value of an expression goes, walking up from it: awaited, returned,
 * dropped as a statement, kept in a variable, passed on.
 */
function followValue(path) {
  let current = path;
  const via = [];
  let chained = false;
  for (let guard = 0; guard < 30; guard += 1) {
    const parentPath = current.parentPath;
    if (!parentPath) return { state: 'other', via, chained };
    const parent = parentPath.node;
    const { key } = current;
    if (t.isAwaitExpression(parent) || t.isReturnStatement(parent) || t.isYieldExpression(parent)) {
      return { state: t.isAwaitExpression(parent) ? 'awaited' : 'returned', via, chained };
    }
    if (t.isArrowFunctionExpression(parent) && key === 'body') return { state: 'returned', via, chained };
    if (t.isExpressionStatement(parent)) return { state: 'statement', via, chained };
    if (t.isUnaryExpression(parent, { operator: 'void' })) {
      via.push('void');
      current = parentPath;
    } else if (t.isLogicalExpression(parent) || t.isSequenceExpression(parent)
      || (t.isConditionalExpression(parent) && key !== 'test')
      || t.isArrayExpression(parent) || t.isSpreadElement(parent)) {
      current = parentPath;
    } else if (isAnyMember(parent) && key === 'object') {
      const callPath = parentPath.parentPath;
      if (callPath && isChainCall(callPath.node) && callPath.node.callee === parent) {
        chained = true;
        via.push(`.${parent.property.name}`);
        current = callPath;
      } else {
        return { state: 'other', via, chained };
      }
    } else if (t.isCallExpression(parent) && current.listKey === 'arguments') {
      if (!isPromiseCombinator(parent.callee)) return { state: 'passed', via, chained, receiver: parent.callee };
      via.push('Promise.*');
      current = parentPath;
    } else if (t.isVariableDeclarator(parent) && key === 'init') {
      return { state: 'variable', via, chained, name: t.isIdentifier(parent.id) ? parent.id.name : null, path: parentPath };
    } else if (t.isAssignmentExpression(parent) && key === 'right') {
      return { state: 'assigned', via, chained, target: parent.left, path: parentPath };
    } else {
      return { state: 'other', via, chained };
    }
  }
  return { state: 'other', via, chained };
}

/**
 * Whether a promise kept in a variable is taken care of. A Set or a Map that
 * only remembers it, as a registry of work in flight, waits for nothing here.
 */
function isVariableConsumed(scopePath, name) {
  const binding = name ? scopePath.scope.getBinding(name) : null;
  if (!binding) return true;
  if (binding.path.parentPath?.parentPath?.isExportNamedDeclaration()) return true;
  for (const reference of binding.referencePaths) {
    const use = followValue(reference);
    if (use.state === 'awaited' || use.state === 'returned') return true;
    if (use.state === 'passed') {
      const stored = t.isMemberExpression(use.receiver) && !use.receiver.computed
        && STORING_METHODS.has(use.receiver.property.name);
      if (!stored) return true;
    }
    if (use.state === 'assigned' || t.isObjectProperty(reference.parent)) return true;
    if (isAnyCall(reference.parent) && reference.key === 'callee') return true;
    if (t.isExportSpecifier(reference.parent) || t.isExportDefaultDeclaration(reference.parent)) return true;
  }
  return false;
}

function isDroppedValue(value) {
  if (value.state === 'statement') return true;
  if (value.state === 'variable') return !isVariableConsumed(value.path.parentPath, value.name);
  if (value.state === 'assigned') {
    return t.isIdentifier(value.target) && !isVariableConsumed(value.path, value.target.name);
  }
  return false;
}

class SourceAnalysis {
  constructor(sources) {
    this.modules = new Map();
    this.functions = [];
    this.functionByNode = new Map();
    this.classes = new Map();
    this.calls = [];
    this.callByNode = new Map();
    for (const [file, source] of sources) this.parseModule(file, source);
    for (const module of this.modules.values()) this.readExports(module);
    for (const call of this.calls) {
      call.resolved = this.resolveCallee(call);
      this.callByNode.set(call.path.node, call);
    }
    this.markFunctionsReturningPromises();
  }

  parseModule(file, source) {
    let ast;
    try {
      ast = parser.parse(source, {
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch (error) {
      throw new Error(`Сторож вызовов без ожидания не смог прочитать ${file}: ${error.message}`);
    }
    const top = { qualifiedName: '<top>', file, isTop: true, isAsync: false, returnsPromise: false };
    const module = { file, ast, top, exports: new Map(), starExports: [], declarations: new Map() };
    this.modules.set(file, module);
    this.functionByNode.set(ast.program, top);
    const usedNames = new Map();
    const visitCall = (path) => {
      const enclosing = path.getFunctionParent();
      this.calls.push({
        path,
        module,
        enclosing: enclosing ? this.functionByNode.get(enclosing.node) : top,
      });
    };
    traverse(ast, {
      Class: (path) => {
        const { node } = path;
        this.classes.set(node, { name: node.id?.name ?? 'class', methods: new Map() });
      },
      Function: (path) => {
        const { node } = path;
        const parentPath = path.getFunctionParent();
        const parent = parentPath ? this.functionByNode.get(parentPath.node) : top;
        const name = functionName(path, this.classes);
        const base = parent.isTop ? name : `${parent.qualifiedName}>${name}`;
        const seen = (usedNames.get(base) ?? 0) + 1;
        usedNames.set(base, seen);
        const info = {
          qualifiedName: seen === 1 ? base : `${base}#${seen}`,
          file,
          isAsync: Boolean(node.async),
          returnsPromise: false,
          node,
          path,
        };
        this.functions.push(info);
        this.functionByNode.set(node, info);
        if (t.isClassMethod(node)) this.classes.get(path.parentPath.parent)?.methods.set(node.key.name, info);
      },
      CallExpression: visitCall,
      OptionalCallExpression: visitCall,
    });
  }

  readExports(module) {
    const { declarations, exports, file } = module;
    const body = module.ast.program.body;
    for (const statement of body) {
      const declaration = (t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement))
        && statement.declaration ? statement.declaration : statement;
      if ((t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) && declaration.id) {
        declarations.set(declaration.id.name, declaration);
      } else if (t.isVariableDeclaration(declaration)) {
        for (const declarator of declaration.declarations) {
          if (t.isIdentifier(declarator.id)) declarations.set(declarator.id.name, declarator);
        }
      }
    }
    const external = (entry, name) => (entry.external ? { external: `${file}#${name}` } : entry);
    for (const statement of body) {
      if (t.isExportNamedDeclaration(statement)) {
        this.readNamedExport(module, statement, external);
      } else if (t.isExportAllDeclaration(statement)) {
        module.starExports.push(statement.source.value);
      } else if (t.isExportDefaultDeclaration(statement)) {
        exports.set('default', external(this.exportEntry(module, statement.declaration), 'default'));
      }
    }
  }

  readNamedExport(module, statement, external) {
    const { exports, declarations } = module;
    const { declaration, source, specifiers } = statement;
    if (t.isFunctionDeclaration(declaration)) {
      exports.set(declaration.id.name, { fn: this.functionByNode.get(declaration) });
    } else if (t.isClassDeclaration(declaration)) {
      exports.set(declaration.id.name, { cls: this.classes.get(declaration) });
    } else if (t.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (t.isIdentifier(declarator.id)) {
          exports.set(declarator.id.name, external(this.exportEntry(module, declarator.init), declarator.id.name));
        }
      }
    } else if (source) {
      for (const specifier of specifiers) {
        exports.set(specifier.exported.name, specifier.local
          ? { reexport: { from: source.value, name: specifier.local.name } }
          : { external: `${source.value}#*` });
      }
    } else {
      for (const specifier of specifiers) {
        const entry = declarations.has(specifier.local.name)
          ? this.exportEntry(module, declarations.get(specifier.local.name))
          : { external: true };
        exports.set(specifier.exported.name, external(entry, specifier.local.name));
      }
    }
  }

  exportEntry(module, node) {
    const { declarations } = module;
    if (!node) return { external: true };
    if (t.isFunction(node)) return { fn: this.functionByNode.get(node) };
    if (t.isClass(node)) return { cls: this.classes.get(node) };
    if (t.isVariableDeclarator(node)) return this.exportEntry(module, node.init);
    if (t.isIdentifier(node) && declarations.has(node.name)) {
      return this.exportEntry(module, declarations.get(node.name));
    }
    if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'asyncHandler' }) && node.arguments[0]) {
      return this.exportEntry(module, node.arguments[0]);
    }
    if (t.isObjectExpression(node)) {
      const members = new Map();
      for (const property of node.properties) {
        if (t.isObjectMethod(property)) {
          members.set(keyName(property), { fn: this.functionByNode.get(property) });
        } else if (t.isObjectProperty(property)) {
          if (t.isFunction(property.value)) {
            members.set(keyName(property), { fn: this.functionByNode.get(property.value) });
          } else if (t.isIdentifier(property.value) && declarations.has(property.value.name)) {
            members.set(keyName(property), this.exportEntry(module, declarations.get(property.value.name)));
          }
        }
      }
      return { members };
    }
    return { external: true };
  }

  resolveModule(fromFile, specifier) {
    if (!specifier.startsWith('.')) return null;
    const target = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    return [target, `${target}.js`, `${target}/index.js`].find((name) => this.modules.has(name)) ?? null;
  }

  exportOf(file, name, depth = 0) {
    const module = this.modules.get(file);
    if (!module || depth > 5) return null;
    const entry = module.exports.get(name);
    if (entry?.reexport) {
      const origin = this.resolveModule(file, entry.reexport.from);
      return origin
        ? this.exportOf(origin, entry.reexport.name, depth + 1)
        : { external: `${entry.reexport.from}#${entry.reexport.name}` };
    }
    if (entry) return entry;
    for (const star of module.starExports) {
      const origin = this.resolveModule(file, star);
      const found = origin ? this.exportOf(origin, name, depth + 1) : null;
      if (found) return found;
    }
    return null;
  }

  fromEntry(entry, desc) {
    if (!entry) return { kind: 'external', desc };
    if (entry.fn) return { kind: 'function', fn: entry.fn };
    if (entry.cls) return { kind: 'class', cls: entry.cls };
    if (entry.members) {
      const members = new Map();
      for (const [name, member] of entry.members) members.set(name, this.fromEntry(member, `${desc}.${name}`));
      return { kind: 'object', members };
    }
    return { kind: 'external', desc: entry.external ?? desc };
  }

  resolveImport(bindingPath, file) {
    const { node } = bindingPath;
    const specifier = bindingPath.parent.source.value;
    const origin = this.resolveModule(file, specifier);
    const isNamespace = t.isImportNamespaceSpecifier(node);
    const imported = t.isImportDefaultSpecifier(node) ? 'default' : (node.imported?.name ?? node.imported?.value);
    if (!origin) return { kind: 'external', desc: `${specifier}#${isNamespace ? '*' : imported}` };
    if (isNamespace) return { kind: 'namespace', file: origin };
    return this.fromEntry(this.exportOf(origin, imported), `${origin}#${imported}`);
  }

  resolveVariable(bindingPath, name, file, depth) {
    const declarator = bindingPath.node;
    const init = stripAwait(declarator.init);
    if (!init) return { kind: 'local', name };
    if (t.isCallExpression(init) && t.isImport(init.callee) && t.isStringLiteral(init.arguments[0])) {
      const origin = this.resolveModule(file, init.arguments[0].value);
      if (origin && t.isObjectPattern(declarator.id)) {
        for (const property of declarator.id.properties) {
          if (t.isObjectProperty(property) && t.isIdentifier(property.value, { name })) {
            return this.fromEntry(this.exportOf(origin, property.key.name), `${origin}#${property.key.name}`);
          }
        }
      }
      if (origin) return { kind: 'namespace', file: origin };
    }
    if (t.isFunction(init)) return { kind: 'function', fn: this.functionByNode.get(init) };
    if (t.isObjectExpression(init)) return this.resolveObject(init, bindingPath, file, depth);
    if (t.isIdentifier(init)) {
      const value = this.resolveName(bindingPath.scope, init.name, file, depth + 1);
      if (!t.isObjectPattern(declarator.id)) return value;
      const property = declarator.id.properties.find((candidate) => t.isObjectProperty(candidate)
        && t.isIdentifier(candidate.value, { name }));
      return property ? this.memberOf(value, keyName(property)) : { kind: 'local', name };
    }
    if (t.isNewExpression(init)) {
      const constructed = this.resolveExpression(init.callee, bindingPath.scope, file, depth + 1);
      if (constructed.kind === 'class') return { kind: 'instance', cls: constructed.cls };
      return { kind: 'external', desc: `new ${constructed.desc ?? '?'}` };
    }
    if (t.isCallExpression(init)) {
      if (t.isIdentifier(init.callee, { name: 'asyncHandler' }) && t.isFunction(init.arguments[0])) {
        return { kind: 'function', fn: this.functionByNode.get(init.arguments[0]) };
      }
      const made = this.resolveExpression(init.callee, bindingPath.scope, file, depth + 1);
      if (made.kind === 'external') return { kind: 'external', desc: `${made.desc}()` };
    }
    return { kind: 'local', name };
  }

  resolveObject(init, bindingPath, file, depth) {
    const members = new Map();
    for (const property of init.properties) {
      if (t.isObjectMethod(property)) {
        members.set(keyName(property), { kind: 'function', fn: this.functionByNode.get(property) });
      } else if (t.isObjectProperty(property)) {
        if (t.isFunction(property.value)) {
          members.set(keyName(property), { kind: 'function', fn: this.functionByNode.get(property.value) });
        } else if (t.isIdentifier(property.value)) {
          members.set(keyName(property), this.resolveName(bindingPath.scope, property.value.name, file, depth + 1));
        }
      }
    }
    return { kind: 'object', members };
  }

  resolveName(scope, name, file, depth = 0) {
    const binding = scope.getBinding(name);
    if (!binding) return { kind: 'external', desc: `global:${name}` };
    if (depth > 6) return { kind: 'external', desc: `deep:${name}` };
    const { path: bindingPath } = binding;
    const { node } = bindingPath;
    if (t.isImportSpecifier(node) || t.isImportDefaultSpecifier(node) || t.isImportNamespaceSpecifier(node)) {
      return this.resolveImport(bindingPath, file);
    }
    if (t.isFunctionDeclaration(node)) return { kind: 'function', fn: this.functionByNode.get(node) };
    if (t.isClassDeclaration(node)) return { kind: 'class', cls: this.classes.get(node) };
    if (t.isVariableDeclarator(node)) return this.resolveVariable(bindingPath, name, file, depth);
    return { kind: 'local', name };
  }

  memberOf(owner, property) {
    switch (owner.kind) {
      case 'namespace':
        return this.fromEntry(this.exportOf(owner.file, property), `${owner.file}#${property}`);
      case 'object':
        return owner.members.get(property) ?? { kind: 'external', desc: `obj.${property}` };
      case 'class':
      case 'instance': {
        const method = owner.cls?.methods.get(property);
        return method ? { kind: 'function', fn: method } : { kind: 'external', desc: `${owner.cls?.name ?? '?'}.${property}` };
      }
      case 'external':
        return { kind: 'external', desc: `${owner.desc}.${property}` };
      case 'local':
        return { kind: 'external', desc: `local:${owner.name ?? '?'}.${property}` };
      case 'function':
        return { kind: 'external', desc: `fnprop.${property}` };
      default:
        return { kind: 'external', desc: `unk.${property}` };
    }
  }

  resolveExpression(node, scope, file, depth = 0, contextPath = null) {
    if (t.isIdentifier(node)) return this.resolveName(scope, node.name, file, depth);
    if (t.isFunction(node)) return { kind: 'function', fn: this.functionByNode.get(node) };
    if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
      const properties = [];
      let root = node;
      while (t.isMemberExpression(root) || t.isOptionalMemberExpression(root)) {
        properties.unshift(root.computed ? '[]' : (root.property.name ?? root.property.value ?? '?'));
        root = root.object;
      }
      let owner;
      if (t.isThisExpression(root)) {
        const classPath = contextPath?.findParent((path) => path.isClass());
        owner = classPath ? { kind: 'instance', cls: this.classes.get(classPath.node) } : { kind: 'external', desc: 'this' };
      } else if (t.isCallExpression(root)) {
        const called = this.resolveExpression(root.callee, scope, file, depth + 1, contextPath);
        owner = { kind: 'external', desc: called.kind === 'external' ? `${called.desc}()` : 'call()' };
      } else if (t.isIdentifier(root)) {
        owner = this.resolveName(scope, root.name, file, depth);
      } else {
        owner = { kind: 'external', desc: root.type };
      }
      return properties.reduce((current, property) => this.memberOf(current, property), owner);
    }
    if (t.isCallExpression(node)) {
      const called = this.resolveExpression(node.callee, scope, file, depth + 1, contextPath);
      return { kind: 'external', desc: called.kind === 'external' ? `${called.desc}()` : 'call()' };
    }
    return { kind: 'external', desc: node.type };
  }

  resolveCallee(call) {
    const { path, module } = call;
    const { callee } = path.node;
    if (t.isFunction(callee)) return { kind: 'function', fn: this.functionByNode.get(callee), iife: true };
    if (t.isIdentifier(callee) || t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)
      || t.isCallExpression(callee)) {
      return this.resolveExpression(callee, path.scope, module.file, 0, path);
    }
    return { kind: 'external', desc: callee.type };
  }

  isAsyncTarget(resolved, callNode) {
    if (resolved.kind === 'function') return Boolean(resolved.fn?.isAsync || resolved.fn?.returnsPromise);
    if (resolved.kind === 'external') {
      return isLibraryCallAsync(resolved.desc, t.isFunction(callNode.arguments[callNode.arguments.length - 1]));
    }
    return false;
  }

  /** Non-async functions that hand back a promise count as async, to a fixed point. */
  markFunctionsReturningPromises() {
    const returnsPromise = (expressionPath) => {
      const { node } = expressionPath;
      if (!node) return false;
      if (t.isNewExpression(node) && t.isIdentifier(node.callee, { name: 'Promise' })) return true;
      if (t.isIdentifier(node)) {
        const binding = expressionPath.scope.getBinding(node.name);
        if (!binding) return false;
        const candidates = [];
        if (t.isVariableDeclarator(binding.path.node) && binding.path.node.init) candidates.push(binding.path.node.init);
        for (const write of binding.constantViolations) {
          if (t.isAssignmentExpression(write.node)) candidates.push(write.node.right);
        }
        return candidates.map(stripAwait).some((candidate) => t.isCallExpression(candidate) && (
          isChainCall(candidate) || this.isAsyncCall(candidate)
        ));
      }
      if (t.isCallExpression(node)) {
        if (!this.callByNode.has(node)) return false;
        const { callee } = node;
        const isPromiseStatic = t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: 'Promise' })
          && (COMBINATORS.has(callee.property.name) || ['resolve', 'reject'].includes(callee.property.name));
        return this.isAsyncCall(node) || isChainCall(node) || isPromiseStatic;
      }
      return false;
    };
    const candidates = this.functions.filter((fn) => !fn.isAsync);
    let changed = true;
    for (let round = 0; changed && round < 10; round += 1) {
      changed = false;
      for (const fn of candidates) {
        if (!fn.returnsPromise) {
          let found = false;
          const body = fn.path.get('body');
          if (!t.isBlockStatement(fn.node.body)) {
            found = returnsPromise(body);
          } else {
            body.traverse({
              Function(path) { path.skip(); },
              ReturnStatement(path) {
                if (returnsPromise(path.get('argument'))) found = true;
              },
            });
          }
          if (found) {
            fn.returnsPromise = true;
            changed = true;
          }
        }
      }
    }
  }

  isAsyncCall(node) {
    const call = this.callByNode.get(node);
    return Boolean(call) && this.isAsyncTarget(call.resolved, node);
  }

  /** Every call nobody waits for. */
  findSites() {
    const sites = [];
    for (const call of this.calls) this.inspectCall(call, sites);
    return sites;
  }

  inspectCall(call, sites) {
    const { path, enclosing, module } = call;
    const { node } = path;
    const parentPath = path.parentPath;
    // The inner link of a chain is judged with the chain's outermost call.
    if (isAnyMember(parentPath.node) && path.key === 'object' && parentPath.key === 'callee'
      && isChainCall(parentPath.parent)) return;

    let base = node;
    while (isChainCall(base) && isAnyCall(stripAwait(base.callee.object))) {
      base = stripAwait(base.callee.object);
    }
    const baseCall = this.callByNode.get(base) ?? call;
    const isChainLink = isChainCall(node);
    const baseIsAsync = this.isAsyncTarget(baseCall.resolved, base) || isChainLink;
    const value = followValue(path);
    const site = (pattern, callee) => sites.push({
      pattern,
      file: module.file,
      line: node.loc.start.line,
      function: enclosing.qualifiedName,
      callee,
    });

    this.inspectCallbacks({ call, value, isChainLink, site });

    if (value.state === 'awaited') return;
    if (value.state === 'returned') {
      if (baseIsAsync && this.isReturnedIntoCallback(path)) site('е', shape(base.callee));
      return;
    }
    const isCombinator = isPromiseCombinator(node.callee);
    const inCombinator = value.via.includes('Promise.*');
    if (!(baseIsAsync || isCombinator || inCombinator)) return;
    if (inCombinator && !isCombinator) return; // counted on the Promise.* call itself
    if (!isDroppedValue(value)) return;

    let pattern = 'а';
    if (value.state !== 'statement') pattern = 'ж';
    else if (baseCall.resolved.iife) pattern = 'в';
    else if (value.via.includes('void')) pattern = 'д';
    else if (isCombinator || isPromiseCombinator(base.callee)) pattern = 'г';
    else if (value.chained || isChainLink) pattern = 'б';
    site(pattern, shape(base.callee));
  }

  /** An async function handed to something that does not wait for it. */
  inspectCallbacks({ call, value, isChainLink, site }) {
    const { path, module } = call;
    const { node } = path;
    if (isChainLink) return;
    const calleeShape = shape(node.callee);
    const isTimer = t.isIdentifier(node.callee) && TIMERS.has(node.callee.name);
    const isEvent = t.isMemberExpression(node.callee) && !node.callee.computed
      && EVENT_METHODS.has(node.callee.property.name);
    const isRoute = t.isMemberExpression(node.callee) && !node.callee.computed
      && ROUTE_METHODS.has(node.callee.property.name) && /(router|app)$/i.test(calleeShape.split('.')[0]);
    if (isRoute || t.isIdentifier(node.callee, { name: 'asyncHandler' })) return;
    for (const argument of node.arguments) {
      let target = null;
      if (t.isFunction(argument)) {
        target = this.functionByNode.get(argument);
      } else if (t.isIdentifier(argument) || t.isMemberExpression(argument)) {
        const resolved = this.resolveExpression(argument, path.scope, module.file, 0, path);
        if (resolved.kind === 'function') target = resolved.fn;
      }
      // An inline function's own `return save()` is reported at save, by isReturnedIntoCallback.
      const givesPromise = target?.isAsync || (target?.returnsPromise && !t.isFunction(argument));
      if (givesPromise && (isTimer || isEvent || isDroppedValue(value))) site('е', calleeShape);
    }
  }

  /**
   * `items.forEach((i) => save(i))`: the promise goes back into a callback. A chain
   * is judged as a chain. `map` and its like collect the promises, so it depends
   * on what happens to the result; anything else that is not awaited drops them,
   * and returning its result does not help: multer's `parse` returns nothing.
   */
  isReturnedIntoCallback(path) {
    const fnPath = path.getFunctionParent();
    if (!fnPath || fnPath.listKey !== 'arguments' || !t.isCallExpression(fnPath.parent)) return false;
    if (isChainCall(fnPath.parent)) return false;
    const outer = this.callByNode.get(fnPath.parent);
    if (!outer || outer.resolved.kind !== 'external') return false;
    const value = followValue(fnPath.parentPath);
    if (CALLBACK_RESULT_COLLECTED.test(shape(fnPath.parent.callee))) return isDroppedValue(value);
    return value.state === 'returned' || isDroppedValue(value);
  }
}

/**
 * @param {Map<string, string>|Object<string, string>} sources relative path → source text
 * @returns {Array<{pattern, file, line, function, callee}>}
 */
export function findUnawaitedCalls(sources) {
  const entries = sources instanceof Map ? sources : new Map(Object.entries(sources));
  return new SourceAnalysis(entries).findSites();
}

/** Every server file under srcDir, tests excluded, by path relative to srcDir. */
export function readServerSources(srcDir) {
  const sources = new Map();
  const walk = (relative) => {
    const entries = readdirSync(join(srcDir, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (child !== 'tests') walk(child);
      } else if (entry.name.endsWith('.js')) {
        sources.set(child, readFileSync(join(srcDir, child), 'utf8'));
      }
    }
  };
  walk('');
  return sources;
}

const keyOf = ({ file, function: fn, callee }) => `${file} | ${fn} | ${callee}`;

/**
 * Inventory rows are keyed by file + function + callee and carry a count, not a
 * line: a line number moves with any edit above it, and would red someone else's
 * pull request.
 *
 * @returns {{added: Array, changed: Array, gone: Array}}
 */
export function compareWithInventory(sites, rows) {
  const found = new Map();
  for (const site of sites) {
    const key = keyOf(site);
    if (!found.has(key)) {
      found.set(key, { file: site.file, function: site.function, callee: site.callee, pattern: site.pattern, lines: [] });
    }
    found.get(key).lines.push(site.line);
  }
  const known = new Map(rows.map((row) => [keyOf(row), row]));
  const added = [...found.entries()].filter(([key]) => !known.has(key)).map(([, place]) => place);
  const changed = [...found.entries()]
    .filter(([key, place]) => known.has(key) && known.get(key).count !== place.lines.length)
    .map(([key, place]) => ({ ...place, expected: known.get(key).count }));
  const gone = rows.filter((row) => !found.has(keyOf(row)));
  return { added, changed, gone };
}

export { REASON_PLACEHOLDER };

/** The guard's message, for a person who has never seen this guard. */
export function describeDifference({ added, changed, gone }, inventoryName) {
  const parts = [];
  for (const place of added) {
    const row = JSON.stringify({
      file: place.file,
      function: place.function,
      callee: place.callee,
      count: place.lines.length,
      class: 'намеренно фоновая',
      reason: REASON_PLACEHOLDER,
    });
    parts.push([
      `Новый вызов без ожидания: ${place.file}:${place.lines.join(',')}, функция ${place.function}, вызов ${place.callee}.`,
      '  Ответ может уйти раньше, чем он закончится; при выкатке его работа может потеряться.',
      place.pattern === 'е'
        ? '  Этот вызов не ждёт асинхронную функцию (forEach, таймер, обработчик). Дождись записи: for…of с await или await Promise.all(items.map(…)). Если ждать нельзя — добавь в опись строку с причиной:'
        : '  Дождись записи (await). Если ждать нельзя — добавь в опись строку с причиной:',
      `  ${row}`,
      '  В строке замени reason на настоящую причину и выбери class: «намеренно фоновая» или «будет закрыта».',
    ].join('\n'));
  }
  for (const place of changed) {
    parts.push([
      `Таких вызовов стало ${place.lines.length}, в описи ${place.expected}: ${place.file}:${place.lines.join(',')}, функция ${place.function}, вызов ${place.callee}.`,
      `  Стало больше — дождись записи в новом вызове или исправь count и причину. Стало меньше — исправь count на ${place.lines.length}.`,
    ].join('\n'));
  }
  for (const row of gone) {
    parts.push([
      `В описи есть строка, а вызова в коде нет: ${row.file}, функция ${row.function}, вызов ${row.callee}.`,
      '  Если вызов теперь ждут или его убрали — убери строку. Если функцию переименовали или у неё сдвинулся номер в имени (#2) — поправь строку.',
    ].join('\n'));
  }
  return [
    `Сторож вызовов без ожидания: код сервера разошёлся с описью ${inventoryName}.`,
    '',
    ...parts,
    '',
    'Опись одна на все ветки. Столкнулись на ней с другой веткой — обновись от main и поправь только свою строку.',
    'Проверить у себя: cd backend && node scripts/test-isolated <имя> --testPathPatterns=unit/unawaited-calls-guard',
  ].join('\n');
}
