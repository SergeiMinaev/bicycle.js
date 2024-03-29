window._callbacks = {};
window._comps = [];


export class El {
  constructor(rootNode, tplId) {
    this.rootNode = rootNode;
    this.tplId = tplId;
    this.context = {};
  }
  cleanup() {
    window._comps.forEach((el, idx) => {
      if (!el.rootNode.isConnected) {
        if (el.destroyed) el.destroyed();
        window._comps.splice(idx, 1);
      }
    });
  }
  mount() {
    this.cleanup();
    window._comps.push(this);
    if (this.created) this.created();
    this.render();
  }
  render() {
    this.tpl = document.getElementById(this.tplId).content.cloneNode(true);
    this.processTpl(this.tpl);
    this.rootNode.innerHTML = '';
    this.rootNode.appendChild(this.tpl);
    if (this.isRouterUsed) this.router.renderRouterView();
  }
  processTpl(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeName != '#text') this.processNode(child);
      this.processTpl(child);
    });
  }
  processNode(el) {
    this.handleIfs(el);
    this.handleLoops(el);
    this.handleComponents(el);
    this.handleVars(el);
    this.handleClicks(el);
    this.handleAdvanced(el);
    this.router.handleRoutes(el);
  }
  handleIfs(el) {
    if (el.attributes['@if']) {
      let name = el.attributes['@if'].value.replace('()','');
      let bool = true;
      if (name.startsWith('!')) {
        name = name.slice(1); bool = false;
      }
      el.removeAttribute('@if');
      if (!!(this.methods[name]()) !== bool) el.parentNode.removeChild(el);
    }
  }
  handleComponents(el) {
    if (!el.nodeName.startsWith('C-')) return;
    const compName = el.nodeName.toLowerCase().replace('c-', '');
    new window.components[compName](el).mount();
  }
  handleLoops(el) {
    if (el.attributes['@for']) {
      const val = el.attributes['@for'].value;
      const [itemName, _, srcName] = val.split(' ');
      const src = resolve(srcName.split('state.')[1], window.state);
      if (!src) return;
      // iter backwards because we're using insertBefore
      for (let index = src.length - 1; index >= 0; index--) {
        const item = src[index];
        this.context[itemName] = item;
        const elClone = el.cloneNode(true);
        el.parentNode.insertBefore(elClone, el.nextSibling);
        this.processTpl(elClone);
      };
      el.parentNode.removeChild(el);
      //this.context[itemName] = undefined;
    }
  }
  handleClicks(el) {
    if (el.attributes['@click']) {
      const methodname = el.attributes['@click'].value;
      el.addEventListener('click', (ev) => {
        this.methods[methodname](ev);
        ev.stopImmediatePropagation();
      });
    }
  }
  handleVars(el) {
    if (el.innerHTML.startsWith('{{')) {
      let name = el.innerHTML.replace('{{','').replace('}}','');
      const isMethod = name.includes('()');
      name = name.replace('()','').trim();
      el.innerHTML = this.getVal(name);
    }
  }
  handleAdvanced(el) {
    if (!el.attributes['@value']) return;
    el.value = this.handleAttr(el, '@value');
  }
  handleAttr(el, attr) {
    if (!el.attributes[attr]) return;
    let name = el.attributes[attr].value;
    return this.getVal(name);
  }
  getVal(name) {
    const isMethod = name.includes('()');
    if (isMethod) {
      el.innerHTML = this.strings[name]();
    } else {
      if (name.startsWith('data.')) {
        return resolve(name, this);
      } else if (name.startsWith('state.')) {
        return resolve(name, window);
      } else {
        return resolve(name, this.context);
      }
    }
  }
  router = {
    handleRoutes: (el) => {
      if (el.attributes['@to']) {
        let url = el.attributes['@to'].value;
        if (url.includes('${')) {
          url = interpolate(url, this.context);
        }
        el.addEventListener('click', (event) => {
          window.history.pushState({}, '', url);
          event.stopImmediatePropagation();
        });
      }
    },
    init: () => {
      this.isRouterUsed = true;
      window.history.pushState = new Proxy(window.history.pushState, {
        apply: (target, thisArg, argArray) => {
          target.apply(thisArg, argArray);
          this.router.onHistoryChange();
          return target;
        },
      });
      window.addEventListener('popstate', (event) => {
        this.router.onHistoryBtnClick(event);
      });
    },
    onHistoryBtnClick: (ev) => this.router.renderRouterView(),
    onHistoryChange: (ev) => this.router.renderRouterView(),
    renderRouterView: () => {
      const _routerNode = document.getElementById('router-view');
      if (!_routerNode) return;
      const routerNode = document.createElement('div');
      routerNode.id = 'router-view';
      _routerNode.replaceWith(routerNode);
      window.$route = undefined;
      const [_, route] = Object.entries(window.routes).find(
        (route) => {
          route = route[1];
          const routeMatcher = new RegExp(route.url.replace(/:[^\s/]+/g, '([\\w-]+)'));
          const url = document.location.pathname.replace(/\/$/, '');
          const match = url.match(routeMatcher);
          if (match) {
            // Current route params are available at window.$route
            window.$route = {
              path: url,
              params: match.splice(1),
            };
            return route;
          }
        }
      );
      if (route) {
        const comp = new route.c(routerNode);
        comp.mount();
        this.router.updateLinks();
      } else { routerNode.innerHTML = '' }
    },
    updateLinks: () => {
      Array.from(document.getElementsByTagName('route'))
          .filter((el) => el.attributes['@to'])
          .forEach((el) => {
        const url = el.attributes['@to'].value;
        if (url == document.location.pathname
            && !el.classList.contains('route-active')) {
          el.classList.add('route--active');
        } else {
          el.classList.remove('route--active');
        };
      });
    },
  }
  /**
   * Subscribe to changes in the specified object in the state.
   * Example: subscribe(['user.email', 'todos'], this.methods.proxyCallback);
   */
  subscribe(paths, fn) {
    paths.forEach((path) => {
      if (window._callbacks[path] === undefined) {
        window._callbacks[path] = [];
      }
      window._callbacks[path].push({c: this, fn: fn});
      if (this._subscriptions === undefined) this._subscriptions = [];
      this._subscriptions.push(path);
    });
  }

}

/**
 * Original state object must be accessible via window._state
 */
export const makeState = () => observable(window._state, mutStateCallback)

export function resolve(path, obj) {
  return path.split('.').reduce((p,c)=>p&&p[c], obj)
}

export const observable = (target, callback, _base = []) => {
  for (const key in target) {
    if (typeof target[key] === 'object' && key != '_callbacks')
      target[key] = observable(target[key], callback, [..._base, key])
  }
  return new Proxy(target, {
    set(target, key, value) {
      if (typeof value === 'object' && key != '_callbacks') {
        value = observable(value, callback, [..._base, key]);
      }
      callback([..._base, key], target[key] = value)
      return true;
      //return value
    }
  })
}

export function mutStateCallback(keys, val) {
  const changedPath = keys.join('.');
  Object.keys(window._callbacks).forEach(watchedPath => {
    if (watchedPath == changedPath
        || (watchedPath+'.').startsWith(changedPath+'.')
        || (changedPath+'.').startsWith(watchedPath+'.')) {
      window._callbacks[watchedPath].forEach( (cbk, idx) => cbk.fn() );
    }
  });
  cleanupCallbacks();
}

export function cleanupCallbacks() {
  Object.keys(window._callbacks).forEach(path => {
    for (let i = 0; i < window._callbacks[path].length; i++) {
      if (!window._callbacks[path][i].c.rootNode.isConnected) {
        window._callbacks[path].splice(i, 1);
        i--;
      }
    }
  });
}

// Emulate template string
function interpolate(s, obj) {
  return s.replace(/[$]{([^}]+)}/g, function(_, path) {
    const properties = path.split('.');
    return properties.reduce((prev, curr) => prev && prev[curr], obj);
  })
}

window.$router = {
  push(route) {
    if (typeof(route) == "object") {
      window.history.pushState({}, '', route.url);
    } else {
      window.history.pushState({}, '', route);
    }
  }
}
