import * as d3 from 'd3';
import { FeatureNode } from './featureNode.js';

let direction = 'v'; // 'v' = vertical, 'h' = horizontal
const rectWidth = 100;
const rectHeight = 30;

// Track collapsed state by node path
let collapsedMap = {};
// Track hidden state by node path
let hiddenMap = {};
// Track hidden siblings info for indicators
let hiddenSiblingsMap = {};
let levelDistance = 100;
let resizeListenerSet = false;
let siblingDistance = 25;
let currentTransform = d3.zoomIdentity;
let isFirstRender = true;
let initialTransformGlobal = null;
let forceInitialView = false;

// Theme management
let currentTheme = 'kandinsky'; // 'kandinsky', 'nge', or 'featureide'

function getNodePath(node) {
  let path = [];
  let n = node;
  while (n.parent) {
    path.unshift(n.data.name);
    n = n.parent;
  }
  path.unshift('root');
  return path.join('/');
}

function setupZoom(svg, svgContent, width, height) {
  const zoom = d3.zoom()
    .scaleExtent([0.5, 2])
    .filter(event => {
      // Only allow wheel for zoom, and left mouse for pan, but not if target is a node or indicator node
      return (
        (event.type === 'wheel' || (event.type === 'mousedown' && event.button === 0)) &&
        !event.target.closest('.fme-node') &&
        !event.target.closest('.fme-indicator-node')
      );
    })
    .on('start', function() {
      svg.classed('fme-grabbed', true).classed('fme-grabbable', false);
    })
    .on('zoom', (event) => {
      svgContent.attr('transform', event.transform);
      currentTransform = event.transform;
    })
    .on('end', function() {
      svg.classed('fme-grabbed', false).classed('fme-grabbable', true);
    });
  svg.call(zoom).on('dblclick.zoom', null);
  // Do NOT re-apply currentTransform here; let D3 manage it after user interaction
  return zoom;
}

function zoomToFit(svg, svgContent, width, height) {
  const bounds = svgContent.node().getBBox();
  const fullWidth = width, fullHeight = height;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  if (bounds.width === 0 || bounds.height === 0) return;
  const scale = Math.max(0.5, Math.min(2, 0.75 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight)));
  const transform = d3.zoomIdentity
    .translate(fullWidth / 2, fullHeight / 2)
    .scale(scale)
    .translate(-midX, -midY);
  svg.transition().duration(0)
    .call(
      d3.zoom().transform,
      transform
    );
  currentTransform = transform;
}

function positionLegendNextToTreeBBox(containerId) {
  const legend = document.getElementById('fme-legend');
  if (!legend) return;
  if (legend.dataset.userMoved === 'true') return;
  const container = document.getElementById(containerId);
  const svg = document.querySelector(`#${containerId} svg`);
  if (!svg) return;
  const g = svg.querySelector('g#draggable');
  if (!g) return;
  // Get bounding box in SVG coordinates
  const bbox = g.getBBox();
  // Convert (bbox.x + bbox.width, bbox.y) to screen coordinates
  const pt = svg.createSVGPoint();
  pt.x = bbox.x + bbox.width;
  pt.y = bbox.y;
  const screenPt = pt.matrixTransform(g.getScreenCTM());
  legend.style.position = 'absolute';
  legend.classList.add('fme-noselect');
  legend.style.left = (screenPt.x + 100) + 'px';
  legend.style.top = (screenPt.y) + 'px';
  legend.dataset.userMoved = 'true';
  // Ensure legend is fully visible in the container
  const legendRect = legend.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (legendRect.right > containerRect.right || legendRect.bottom > containerRect.bottom) {
    legend.style.left = (containerRect.right - legendRect.width) + 'px';
    legend.style.top = containerRect.top + 'px';
  }
}

function ensureLegend() {
  if (document.getElementById('fme-legend')) return;
  const legend = document.createElement('div');
  legend.id = 'fme-legend';
  legend.innerHTML = `
    <div class="fme-legend-drag-handle">Legend</div>
    <div class="fme-legend-content">
      <div class="fme-legend-row-single" data-legend-type="base"><svg width="160" height="40"><g class="fme-node fme-legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Feature</text></g></svg></div>
      <div class="fme-legend-row-single" data-legend-type="abstract"><svg width="160" height="40"><g class="fme-node fme-legend fme-abstract"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Abstract Feature</text></g></svg></div>
      <div class="fme-legend-row-single" data-legend-type="mandatory"><svg width="160" height="40"><g class="fme-node fme-legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><circle cx="80" cy="10" r="5" class="fme-mandatory-marker"/><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Mandatory Feature</text></g></svg></div>
      <div class="fme-legend-row-single" data-legend-type="optional"><svg width="160" height="40"><g class="fme-node fme-legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><circle cx="80" cy="10" r="5" class="fme-optional-marker"/><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Optional Feature</text></g></svg></div>
      <div class="fme-legend-sep"></div>
      <div class="fme-legend-row-single" data-legend-type="core"><svg width="160" height="40"><g class="fme-node fme-legend fme-core"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Core Feature</text></g></svg></div>
      <div class="fme-legend-row-single" data-legend-type="dead"><svg width="160" height="40"><g class="fme-node fme-legend fme-dead"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Dead Feature</text></g></svg></div>
      <div class="fme-legend-sep"></div>
      <div class="fme-legend-row-double" data-legend-type="alt-group"><div class="fme-legend-col-icon"><svg width="40" height="40"><path d="M20,10 L3,30 Z M20,10 L37,30 Z" class = "fme-edge"/><path d="M20,10 L8,25 A20,40 0 0,0 32,25 Z" class = "fme-alt-group-arc" /></svg></div><div class = "fme-legend-col-label">Alternative Group</div></div>
      <div class="fme-legend-row-double" data-legend-type="or-group"><div class="fme-legend-col-icon"><svg width="40" height="40"><path d="M20,10 L3,30 Z M20,10 L37,30 Z" class = "fme-edge"/><path d="M20,10 L8,25 A20,40 0 0,0 32,25 Z" class = "fme-or-group-arc" /></svg></div><div class = "fme-legend-col-label">Or Group</div></div>
      <div class="fme-legend-row-double" data-legend-type="false-optional"><div class="fme-legend-col-icon"><svg width="32" height="18"><line x1="4" y1="9" x2="22" y2="9" stroke="#d32f2f" stroke-width="2"/><circle cx="26" cy="9" r="5" fill="#fff" stroke="#d32f2f" stroke-width="2"/></svg></div><div class="fme-legend-col-label">False-Optional</div></div>
    </div>
  `;
  document.body.appendChild(legend);
  // Drag logic (draggable from anywhere on the legend)
  let isDragging = false, offsetX = 0, offsetY = 0;
  legend.addEventListener('mousedown', (e) => {
    // Only left mouse button, and not on a form element
    if (e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button')) return;
    isDragging = true;
    offsetX = e.clientX - legend.offsetLeft;
    offsetY = e.clientY - legend.offsetTop;
    legend.classList.add('fme-dragging');
    document.body.classList.add('fme-noselect');
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    legend.style.left = (e.clientX - offsetX) + 'px';
    legend.style.top = (e.clientY - offsetY) + 'px';
    legend.dataset.userMoved = 'true';
  });
  document.addEventListener('mouseup', () => {
    isDragging = false;
    legend.classList.remove('fme-dragging');
    document.body.classList.remove('fme-noselect');
  });
}

function updateLegendVisibility(root) {
  // Collect present types, attrs, and abstract
  const present = {
    mandatory: false,
    optional: false,
    or: false,
    xor: false,
    abstract: false,
    core: false,
    dead: false,
    'false-optional': false
  };
  let visibleNodeCount = 0;
  function scan(node) {
    const path = getNodePath(node);
    visibleNodeCount++;
    if (node.data.type && present.hasOwnProperty(node.data.type)) present[node.data.type] = true;
    if (node.data.abstract === true) present.abstract = true;
    if (node.data.attr) {
      node.data.attr.forEach(a => { if (present.hasOwnProperty(a)) present[a] = true; });
    }
    // If this node is collapsed, do not scan its children
    if (typeof collapsedMap === 'object' && collapsedMap[path]) return;
    if (node.children) node.children.forEach(scan);
  }
  scan(root);

  // Map legend types to present keys
  const legendMap = {
    'mandatory': 'mandatory',
    'optional': 'optional',
    'abstract': 'abstract',
    'core': 'core',
    'dead': 'dead',
    'or-group': 'or',
    'alt-group': 'xor',
    'false-optional': 'false-optional'
  };

  // Determine which legend entries (except base) would be visible
  let nonBaseVisible = 0;
  document.querySelectorAll('#fme-legend [data-legend-type]').forEach(row => {
    const type = row.getAttribute('data-legend-type');
    if (type === 'base') return;
    const key = legendMap[type];
    if (key && present[key]) {
      nonBaseVisible++;
    }
  });

  // Show/hide base legend item
  const baseRow = document.querySelector('#fme-legend [data-legend-type="base"]');
  if (baseRow) {
    if (nonBaseVisible === 0) {
      baseRow.classList.remove('fme-hidden');
    } else {
      baseRow.classList.add('fme-hidden');
    }
  }

  // Show/hide other legend entries
  document.querySelectorAll('#fme-legend [data-legend-type]').forEach(row => {
    const type = row.getAttribute('data-legend-type');
    if (type === 'base') return; // already handled
    const key = legendMap[type];
    if (key && present[key]) {
      // Hide mandatory if only root node is visible
      if (type === 'mandatory' && visibleNodeCount === 1) {
        row.classList.add('fme-hidden');
      } else {
        row.classList.remove('fme-hidden');
      }
    } else {
      row.classList.add('fme-hidden');
    }
  });

  // Hide legend-sep divs that do not separate two visible legend entries
  document.querySelectorAll('#fme-legend .fme-legend-sep').forEach(sep => {
    // Find previous and next visible legend rows
    let prev = sep.previousElementSibling;
    while (prev && (prev.classList.contains('fme-hidden') || !prev.matches('[data-legend-type]'))) prev = prev.previousElementSibling;
    let next = sep.nextElementSibling;
    while (next && (next.classList.contains('fme-hidden') || !next.matches('[data-legend-type]'))) next = next.nextElementSibling;
    if (prev && next) {
      sep.classList.remove('fme-hidden');
    } else {
      sep.classList.add('fme-hidden');
    }
  });
  // Hide any .fme-legend-sep that immediately follows another visible .fme-legend-sep
  let lastWasSep = false;
  document.querySelectorAll('#fme-legend .fme-legend-content > *').forEach(row => {
    if (row.classList.contains('fme-legend-sep') && !row.classList.contains('fme-hidden')) {
      if (lastWasSep) {
        row.classList.add('fme-hidden');
      }
      lastWasSep = true;
    } else if (!row.classList.contains('fme-hidden')) {
      lastWasSep = false;
    }
  });
}

// --- Context Menu Utilities ---
function showContextMenu(event, actions) {
  event.preventDefault();
  d3.selectAll('.custom-context-menu').remove();
  let menu, activeIndex = 0, submenuActiveIndex = -1;
  menu = d3.select('body')
    .append('div')
    .attr('class', 'custom-context-menu')
    .style('position', 'absolute')
    .style('left', `${event.clientX}px`)
    .style('top', `${event.clientY}px`)
    .attr('tabindex', 0)
    .on('keydown', onMenuKeydown);

  // --- Recursive menu rendering (must be hoisted for recursion) ---
  function renderMenuItems(menuSel, items, isMain) {
    menuSel.selectAll('div.menu-item,div.menu-separator').remove();
    items.forEach((a, i) => {
      if (a.separator) {
        menuSel.append('div').attr('class', 'menu-separator');
        return;
      }
      const itemDiv = menuSel.append('div')
        .datum(a)
        .attr('class', function() {
          let base = 'menu-item';
          if (isMain) {
            let isActive = (i === activeIndex) && menu.node() === document.activeElement;
            if (a.disabled) base += ' disabled';
            return base + (isActive ? ' active' : '');
          } else {
            if (a.disabled) base += ' disabled';
            return base + (i === submenuActiveIndex && menuSel.node() === document.activeElement ? ' active' : '');
          }
        })
        .html(function(a2) {
          let content = '';
          if (a2.checked !== undefined) {
            content += `<span class="menu-checkbox">${a2.checked ? '☑' : '☐'}</span> `;
          }
          content += a2.label;
          if (a2.submenu) {
            content += '<span class="submenu-arrow">&#9654;</span>';
          }
          return content;
        })
        .on('click', (e, a2) => {
          if (a2.disabled) return;
          if (a2.submenu) {
            // Do nothing, handled by hover
          } else if (a2.action) {
            closeMenus();
            a2.action();
          }
        });
      // Render submenu as child div if present
      if (a.submenu && Array.isArray(a.submenu)) {
        const submenuDiv = itemDiv.append('div')
          .attr('class', 'custom-context-menu submenu')
          .style('left', '100%')
          .style('top', '0')
          .style('display', 'none');
        renderMenuItems(submenuDiv, a.submenu, false);
        itemDiv.on('mouseenter', function() {
          submenuDiv.style('display', 'block');
        });
        itemDiv.on('mouseleave', function() {
          submenuDiv.style('display', 'none');
        });
        itemDiv.on('focusin', function() {
          submenuDiv.style('display', 'block');
        });
        itemDiv.on('focusout', function() {
          submenuDiv.style('display', 'none');
        });
      }
    });
  }

  renderMenuItems(menu, actions, true);
  menu.node().focus();

  // --- Close menu on outside click ---
  function onWindowDown(e) {
    // If click is outside any .custom-context-menu, close all
    if (!e.target.closest('.custom-context-menu')) {
      closeMenus();
    }
  }
  window.addEventListener('mousedown', onWindowDown, true);

  function closeMenus() {
    d3.selectAll('.custom-context-menu').remove();
    window.removeEventListener('mousedown', onWindowDown, true);
    window.removeEventListener('keydown', onKey, true);
  }

  function onMenuKeydown(e) {
    const items = actions;
    if (e.key === 'ArrowDown') {
      activeIndex = (activeIndex + 1) % items.length;
      updateActive();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActive();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && items[activeIndex].submenu) {
      openSubmenu(items[activeIndex], activeIndex, menu.selectAll('div.menu-item').nodes()[activeIndex]);
      if (submenu) submenu.node().focus();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (items[activeIndex].submenu) {
        openSubmenu(items[activeIndex], activeIndex, menu.selectAll('div.menu-item').nodes()[activeIndex]);
        if (submenu) submenu.node().focus();
      } else if (items[activeIndex].action) {
        closeMenus();
        items[activeIndex].action();
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeMenus();
      e.preventDefault();
    }
  }
  function onKey(e) {
    if (e.key === 'Escape') closeMenus();
  }
  setTimeout(() => {
    window.addEventListener('mousedown', onWindowDown, true);
    window.addEventListener('keydown', onKey, true);
  }, 0);
}

// --- Reset View Utility ---
function resetView(svg, svgContent, width, height, containerId, shouldUncollapse = false, options = {}) {
  if (shouldUncollapse) {
    collapsedMap = {};
    hiddenMap = {};
    hiddenSiblingsMap = {};
    forceInitialView = true;
    isFirstRender = true;
    renderFeatureModel(containerId, options);
    return;
  }
  // Fallback: just trigger a full re-render as on initial
  forceInitialView = true;
  isFirstRender = true;
  renderFeatureModel(containerId, options);
}

// --- Legend Auto-Position Utility ---
function positionLegendAuto(containerId) {
  setTimeout(() => {
    const legend = document.getElementById('fme-legend');
    if (legend) {
      positionLegendNextToTreeBBox(containerId);
    }
  }, 0);
}

// --- Export Utilities ---
function exportAsSVG() {
  // Get the main SVG
  const svgElem = document.querySelector('.fme-main-svg');
  if (!svgElem) {
    alert('No SVG found to export.');
    return;
  }
  // Clone the SVG node
  const clone = svgElem.cloneNode(true);
  // Inline CSS from fm.css
  fetch('css/fm.css')
    .then(response => response.text())
    .then(css => {
      // Remove everything before .fme-main-svg
      const idx = css.indexOf('.fme-main-svg');
      if (idx !== -1) css = css.slice(idx);
      // Sanitize CSS: remove comments, newlines, carriage returns, tabs, and excessive whitespace
      css = css.replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, ' '); // remove /* ... */ comments
      css = css.replace(/\\[nrt]/g, ' '); // remove newlines, carriage returns, tabs
      css = css.replace(/\s+/g, ' ').trim(); // collapse whitespace
      const styleElem = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleElem.setAttribute('type', 'text/css');
      styleElem.innerHTML = css;
      clone.insertBefore(styleElem, clone.firstChild);
      // Remove all transforms from <g id="draggable">
      const g2 = clone.querySelector('g#draggable');
      if (g2) {
        g2.removeAttribute('transform');
      }
      // Find all node rects
      const nodeRects = Array.from(svgElem.querySelectorAll('g.fme-node rect'));
      if (nodeRects.length === 0) {
        alert('No nodes found in SVG.');
        return;
      }
      const rootRect = nodeRects[0];
      const rootBox = rootRect.getBoundingClientRect();
      console.log(rootBox)
      let minX = rootBox.x;
      nodeRects.forEach(r => {
        const box = r.getBoundingClientRect();
        if (box.x < minX) minX = box.x;
      });
      const rootX = rootBox.x;
      const delta = Math.abs(minX - rootX);
      // Translate the entire SVG by -delta in x-direction
      const children = Array.from(clone.childNodes).filter(n => n.nodeName !== 'style');
      const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrapper.setAttribute('transform', `translate(${delta},0)`);
      children.forEach(child => wrapper.appendChild(child));
      Array.from(clone.childNodes).forEach(n => {
        if (n.nodeName !== 'style') clone.removeChild(n);
      });
      const styleNode = clone.querySelector('style');
      if (styleNode && styleNode.nextSibling) {
        clone.insertBefore(wrapper, styleNode.nextSibling);
      } else {
        clone.appendChild(wrapper);
      }
      clone.removeAttribute('style');
      // Serialize SVG
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(clone);
      // Final sanitation: remove all \n, \r, \t and collapse whitespace in the SVG string
      source = source.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!source.match(/^<\?xml/)) {
        source = '<?xml version="1.0" standalone="no"?>\n' + source;
      }
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'feature-model.svg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
}

function exportAsPNG(includeLegend = true) {
  // TODO: Render SVG to canvas, export as PNG
  alert('Export as PNG' + (includeLegend ? '' : ' (w/o legend)') + ' not yet implemented.');
}

function buildFeatureNodeFromObject(obj) {
  if (!obj) return null;
  const { name, children = [], groupType, abstract, type, attr } = obj;
  return new FeatureNode(name, {
    children: (children || []).map(buildFeatureNodeFromObject),
    groupType,
    abstract,
    type,
    attr
  });
}

// Utility: find node in plain model object by path
function getModelNodeByPath(model, path) {
  const parts = path.split('/').slice(1); // skip 'root'
  let node = model;
  for (const part of parts) {
    if (!node.children) return null;
    node = node.children.find(child => child.name === part);
    if (!node) return null;
  }
  return node;
}

// --- Auto-collapse helper ---
function autoCollapseDeeperThan(root, maxLevel) {
  root.each(function(d) {
    if (d.depth > maxLevel && d.children) {
      collapsedMap[getNodePath(d)] = true;
    }
  });
}

function isEnglishFeatureName(name) {
  // Split on non-alphabetic characters, check each part
  const parts = name.split(/[^A-Za-z]+/).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(part => isEnglish(part));
}

// Helper: get display text for a node
function getDisplayText(name) {
  if (typeof name !== 'string') return '';
  const first6 = name.slice(0, 6);
  const letterCount = (first6.match(/[a-zA-Z]/g) || []).length;
  if (name.length > 6 && letterCount <= 3) {
    return first6;
  }
  return name;
}

// Theme toggle function
function toggleTheme(nextTheme) {
  if (nextTheme) {
    currentTheme = nextTheme;
  } else {
    // Cycle through themes
    currentTheme = currentTheme === 'kandinsky' ? 'nge' : (currentTheme === 'nge' ? 'featureide' : 'kandinsky');
  }
  const body = document.body;
  body.classList.remove('fme-nge-theme', 'fme-featureide-theme');
  if (currentTheme === 'nge') {
    body.classList.add('fme-nge-theme');
  } else if (currentTheme === 'featureide') {
    body.classList.add('fme-featureide-theme');
  }
  // Re-render to apply theme changes
  if (window.currentFeatureModelOptions) {
    renderFeatureModel(window.currentFeatureModelContainer, window.currentFeatureModelOptions);
  }
}

// --- Insert indicator nodes for hidden siblings ---
class IndicatorNode {
  constructor({ indicatorType, groupIdx, hiddenIndices }) {
    this.indicatorType = indicatorType;
    this.groupIdx = groupIdx;
    this.hiddenIndices = hiddenIndices;
    this.children = [];
  }
  toObject() {
    return {
      indicatorType: this.indicatorType,
      groupIdx: this.groupIdx,
      hiddenIndices: this.hiddenIndices,
      children: []
    };
  }
}

function insertIndicatorNodes(node, parentPath = 'root') {
  if (!node.children || node.children.length === 0) return;
  const groups = hiddenSiblingsMap[parentPath] || [];
  if (groups.length === 0) {
    node.children.forEach(child => insertIndicatorNodes(child, parentPath + '/' + child.name));
    return;
  }
  let newChildren = [];
  let i = 0;
  while (i < node.children.length) {
    let groupIdx = -1;
    let group = null;
    for (let gi = 0; gi < groups.length; ++gi) {
      if (groups[gi][0] === i) {
        groupIdx = gi;
        group = groups[gi];
        break;
      }
    }
    if (group && group.length > 0) {
      const firstIdx = group[0];
      const lastIdx = group[group.length - 1];
      let indicatorType = 'diamond';
      if (firstIdx === 0) indicatorType = 'left';
      else if (lastIdx === node.children.length - 1) indicatorType = 'right';
      // Create as IndicatorNode
      const indicatorNode = new IndicatorNode({
        indicatorType,
        groupIdx,
        hiddenIndices: group.slice()
      });
      newChildren.push(indicatorNode);
      i = lastIdx + 1;
    } else {
      newChildren.push(node.children[i]);
      insertIndicatorNodes(node.children[i], parentPath + '/' + node.children[i].name);
      i++;
    }
  }
  node.children = newChildren;
}

export function renderFeatureModel(containerId = 'app', options = {}) {
  // Store current options globally for theme re-rendering
  window.currentFeatureModelOptions = options;
  window.currentFeatureModelContainer = containerId;
  
  ensureLegend();
  // Save current transform if SVG exists
  const oldSvg = d3.select(`#${containerId} svg`);
  let prevRootScreenPos = null;
  let direction = options.orientation === 'v' ? 'v' : 'h';
  let levelDistance = typeof options.grow_y === 'number' ? options.grow_y : 100;
  let siblingDistance = typeof options.grow_x === 'number' ? options.grow_x : 25;
  // Use model from options
  if (!options.model) {
    console.warn('No model provided to FeatureModelRenderer.');
    return;
  }
  const featureModelRoot = buildFeatureNodeFromObject(options.model);
  // Insert indicator nodes before filtering
  insertIndicatorNodes(featureModelRoot, 'root');
  if (!oldSvg.empty()) {
    const g = oldSvg.select('g#draggable');
    const transform = g.attr('transform');
    if (transform) {
      const match = /translate\(([^,]+),([^\)]+)\) scale\(([^\)]+)\)/.exec(transform);
      if (match) {
        currentTransform = d3.zoomIdentity
          .translate(+match[1], +match[2])
          .scale(+match[3]);
      } else {
        // Fallback: just parse translate if scale is not present
        const match2 = /translate\(([^,]+),([^\)]+)\)/.exec(transform);
        if (match2) {
          currentTransform = d3.zoomIdentity.translate(+match2[1], +match2[2]);
        }
      }
    }
    // Compute previous root node's screen position
    // Root node is at (rectWidth/2, rectHeight/2) in SVG
    const prevRootSVG = { x: rectWidth / 2, y: rectHeight / 2 };
    prevRootScreenPos = {
      x: currentTransform.applyX(prevRootSVG.x),
      y: currentTransform.applyY(prevRootSVG.y)
    };
  }
  d3.select(`#${containerId} svg`).remove();

  const container = document.getElementById(containerId);
  const width = container.clientWidth || container.offsetWidth || 800;
  const height = container.clientHeight || container.offsetHeight || 600;

  // Set up resize listener once
  if (!resizeListenerSet) {
    window.addEventListener('resize', () => {
      renderFeatureModel(containerId, options);
    });
    resizeListenerSet = true;
  }

  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .classed('fme-main-svg', true)
    .classed('fme-grabbable', true);

  const svgContent = svg.append('g').attr('id', 'draggable');

  // --- Measure text widths for all nodes before layout ---
  // Helper to traverse and collect all node names
  function collectNames(node, level = 0, arr = []) {
    if (!arr[level]) arr[level] = [];
    arr[level].push(node.data.name);
    if (node.children) node.children.forEach(child => collectNames(child, level + 1, arr));
    return arr;
  }
  // Build hierarchy first (no layout yet)
  let root = d3.hierarchy(featureModelRoot);
  // Create a hidden SVG for measuring text widths
  let measureSvg = d3.select('body').select('svg#measure-svg');
  if (measureSvg.empty()) {
    measureSvg = d3.select('body').append('svg').attr('id', 'measure-svg').attr('class', 'fme-measure-svg');
  }
  // Measure widths for all node names
  function measureTextWidth(text) {
    const textElem = measureSvg.append('text').attr('font-family', 'inherit').text(text);
    let w = 0;
    try { w = textElem.node().getBBox().width; } catch (e) { w = text.length * 8; }
    textElem.remove();
    return w;
  }
  root.each(d => {
    if (d.data instanceof IndicatorNode) {
      d._rectWidth = rectHeight; // uniform width for all indicator types
      d._displayText = '';
    } else {
      const displayText = getDisplayText(d.data.name);
      const textWidth = measureTextWidth(displayText);
      const padding = 24;
      d._rectWidth = Math.max(rectWidth, textWidth + padding);
      d._displayText = displayText;
    }
  });
  // Compute max width at each level for layout
  const namesByLevel = collectNames(root);
  const maxWidthByLevel = namesByLevel.map(names => Math.max(...names.map(measureTextWidth)) + 24);
  // Now set up the tree layout so that grow_x is the actual space between adjacent siblings
  const treeLayout = d3.tree()
    .nodeSize([1, rectHeight + levelDistance])
    .separation((a, b) => {
      if (a.data instanceof IndicatorNode || b.data instanceof IndicatorNode) {
        return siblingDistance * 0.125;
      }
      if (a.parent === b.parent) {
        return (a._rectWidth / 2 + siblingDistance + b._rectWidth / 2);
      }
      return 1; // default for non-siblings
    });

  // Build hierarchy with collapsed filtering
  function filterCollapsed(node) {
    if (collapsedMap[getNodePath(node)]) {
      node.children = null;
    } else if (node.children) {
      node.children.forEach(filterCollapsed);
    }
  }

  // Build hierarchy with hidden filtering
  function filterHidden(node) {
    if (hiddenMap[getNodePath(node)]) {
      return null; // Remove this node entirely
    } else if (node.children) {
      node.children = node.children.map(filterHidden).filter(Boolean);
    }
    return node;
  }

  // --- Auto-collapse all but first two levels on initial render ---
  if (isFirstRender) {
    collapsedMap = {};
    hiddenMap = {};
    autoCollapseDeeperThan(root, 1); // keep first two levels expanded
  }
  filterCollapsed(root);
  root = filterHidden(root);
  if (!root) return; // All nodes hidden
  treeLayout(root);

  // Ensure minimum siblingDistance between all nodes at the same level (not just siblings)
  function enforceMinSiblingGap(root, grow_x) {
    const levels = {};
    root.each(d => {
      if (!levels[d.depth]) levels[d.depth] = [];
      levels[d.depth].push(d);
    });
    Object.values(levels).forEach(nodes => {
      // DO NOT SORT! Maintain original sibling order.
      let prevRight = null;
      let prevNode = null;
      nodes.forEach(node => {
        const left = node.x - (node._rectWidth / 2);
        let gap;
        if (prevNode) {
          if (prevNode.parent === node.parent) {
            if (prevNode.data instanceof IndicatorNode || node.data instanceof IndicatorNode) {
              gap = 0.25*grow_x;
            } else {
              gap = grow_x;
            }
          } else {
            gap = 1.5 * grow_x;
          }
        }
        if (prevRight !== null && gap !== undefined && left < prevRight + gap) {
          const shift = (prevRight + gap) - left;
          node.each(n => { n.x += shift; });
        }
        prevRight = node.x + (node._rectWidth / 2);
        prevNode = node;
      });
    });
  }
  enforceMinSiblingGap(root, siblingDistance);

  // Center each parent node over the bounding box of its children
  function centerParentsOverChildren(root) {
    root.eachAfter(node => {
      if (node.children && node.children.length > 0) {
        const left = Math.min(...node.children.map(
          c => c.x - (c._rectWidth / 2)
        ));
        const right = Math.max(...node.children.map(
          c => c.x + (c._rectWidth / 2)
        ));
        const center = (left + right) / 2;
        node.x = center;
      }
    });
  }
  centerParentsOverChildren(root);
  enforceMinSiblingGap(root, siblingDistance);

  // Shift all nodes so root is at (0,0)
  const rootX = root.x;
  const rootY = root.y;
  root.descendants().forEach(d => {
    d.x = d.x - rootX;
    d.y = d.y - rootY;
  });
  // Explicitly set root node to (0,0) to prevent drift after collapse/uncollapse
  root.x = 0;
  root.y = 0;

  // Swap x/y for horizontal
  if (direction === 'h') {
    root.descendants().forEach(d => {
      const tmp = d.x;
      d.x = d.y;
      d.y = tmp;
    });
  }

  // Draw straight lines for links
  svgContent.selectAll('line.fme-edge')
    .data(root.links().filter(d => !(d.target.data instanceof IndicatorNode)))
    .enter()
    .append('line')
    .attr('class', d => {
      let cls = 'fme-edge';
      if (d.target.data.attr && d.target.data.attr.includes('false-optional')) cls += ' fme-edge-false-optional';
      return cls;
    })
    .attr('x1', d => direction === 'v' ? d.source.x : d.source.x + (d.source._rectWidth || rectWidth) / 2)
    .attr('y1', d => direction === 'v' ? d.source.y + rectHeight / 2 : d.source.y)
    .attr('x2', d => direction === 'v' ? d.target.x : d.target.x - (d.target._rectWidth || rectWidth) / 2)
    .attr('y2', d => direction === 'v' ? d.target.y - rectHeight / 2 : d.target.y);

  // Add red marker for false-optional edges
  svgContent.selectAll('circle.fme-edge-false-optional-marker')
    .data(root.links().filter(d => d.target.data.attr && d.target.data.attr.includes('false-optional')))
    .enter()
    .append('circle')
    .attr('class', 'fme-edge-false-optional-marker')
    .attr('r', 6)
    .attr('cx', d => direction === 'v' ? d.target.x + rectWidth / 2 : d.target.x + rectWidth / 2 - rectWidth / 2)
    .attr('cy', d => direction === 'v' ? d.target.y + rectHeight / 2 - rectHeight / 2 : d.target.y + rectHeight / 2);

  // Draw nodes (rects and text)
  svgContent.selectAll('g.node')
    .data(root.descendants())
    .enter()
    .append('g')
    .attr('class', d => 'node ' + (d.data instanceof IndicatorNode ? 'fme-indicator-node' : 'fme-node' + (d.data.abstract ? ' fme-abstract' : '')))
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .on('click', function(event, d) {
      if (d.data instanceof IndicatorNode) {
        // Unhide group
        const { groupIdx, hiddenIndices } = d.data;
        const parentPath = getNodePath(d.parent);
        hiddenIndices.forEach(idx => {
          const siblings = getModelNodeByPath(options.model, parentPath).children;
          const sibPath = parentPath + '/' + siblings[idx].name;
          delete hiddenMap[sibPath];
        });
        hiddenSiblingsMap[parentPath] = (hiddenSiblingsMap[parentPath] || []).filter((g, i) => i !== groupIdx);
        renderFeatureModel(containerId, options);
        return;
      }
      event.stopPropagation();
      const path = getNodePath(d);
      collapsedMap[path] = !collapsedMap[path];
      renderFeatureModel(containerId, options);
    })
    .on('contextmenu', function(event, d) {
      if (d.data instanceof IndicatorNode) return; // No context menu for indicator
      event.preventDefault();
      d3.selectAll('.custom-context-menu').remove();
      const path = getNodePath(d);
      const modelNode = getModelNodeByPath(options.model, path);
      const parentPath = path.split('/').slice(0, -1).join('/');
      const parentModelNode = parentPath ? getModelNodeByPath(options.model, parentPath) : null;
      // Find siblings and index
      let siblings = [];
      let idx = -1;
      if (parentModelNode && parentModelNode.children) {
        siblings = parentModelNode.children;
        idx = siblings.findIndex(child => child.name === d.data.name);
      }
      const actions = [
        { label: 'Change to', submenu: [
          { label: 'mandatory (feature)', action: () => { modelNode.type = 'mandatory'; d3.selectAll('.custom-context-menu').remove(); renderFeatureModel(containerId, options); } },
          { label: 'optional (feature)', action: () => { modelNode.type = 'optional'; d3.selectAll('.custom-context-menu').remove(); renderFeatureModel(containerId, options); } },
          { label: 'or (group)', action: () => {
              if (parentModelNode && parentModelNode.children) {
                parentModelNode.children.forEach(child => { child.type = 'or'; });
              } else {
                modelNode.type = 'or';
              }
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId, options);
            }
          },
          { label: 'xor (group)', action: () => {
              if (parentModelNode && parentModelNode.children) {
                parentModelNode.children.forEach(child => { child.type = 'xor'; });
              } else {
                modelNode.type = 'xor';
              }
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId, options);
            }
          }
        ] },
        { label: 'Rename', action: () => {
            d3.selectAll('.custom-context-menu').remove();
            showRenameInput(d, modelNode, siblings, idx, containerId, options);
          }
        },
        { label: 'Collapsing', submenu: [
          {
            label: (collapsedMap[path] ? 'Uncollapse below' : 'Collapse below'),
            action: (modelNode && modelNode.children && modelNode.children.length > 0) ? () => {
              collapsedMap[path] = !collapsedMap[path];
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId, options);
            } : null,
            disabled: !(modelNode && modelNode.children && modelNode.children.length > 0)
          },
          { label: 'Collapse all siblings to the left', action: () => {
              if (parentModelNode && siblings.length > 1 && idx > 0) {
                let indicesToHide = [];
                for (let i = 0; i < idx; ++i) indicesToHide.push(i);
                if (hiddenSiblingsMap[parentPath]) {
                  hiddenSiblingsMap[parentPath].forEach(group => {
                    group.forEach(i => { if (i < idx && !indicesToHide.includes(i)) indicesToHide.push(i); });
                  });
                }
                setHiddenSiblingsGroup(parentPath, siblings, indicesToHide);
                d3.selectAll('.custom-context-menu').remove();
                renderFeatureModel(containerId, options);
              }
            }
          },
          { label: 'Collapse all siblings to the right', action: () => {
              if (parentModelNode && siblings.length > 1 && idx >= 0 && idx < siblings.length - 1) {
                let indicesToHide = [];
                for (let i = idx + 1; i < siblings.length; ++i) indicesToHide.push(i);
                if (hiddenSiblingsMap[parentPath]) {
                  hiddenSiblingsMap[parentPath].forEach(group => {
                    group.forEach(i => { if (i > idx && !indicesToHide.includes(i)) indicesToHide.push(i); });
                  });
                }
                setHiddenSiblingsGroup(parentPath, siblings, indicesToHide);
                d3.selectAll('.custom-context-menu').remove();
                renderFeatureModel(containerId, options);
              }
            }
          }
        ] },
        { label: 'Hiding', submenu: [
          { label: 'Hide all siblings to the left', action: () => {
              if (parentModelNode && siblings.length > 1 && idx > 0) {
                let indicesToHide = [];
                for (let i = 0; i < idx; ++i) indicesToHide.push(i);
                if (hiddenSiblingsMap[parentPath]) {
                  hiddenSiblingsMap[parentPath].forEach(group => {
                    group.forEach(i => { if (i < idx && !indicesToHide.includes(i)) indicesToHide.push(i); });
                  });
                }
                setHiddenSiblingsGroup(parentPath, siblings, indicesToHide);
                d3.selectAll('.custom-context-menu').remove();
                renderFeatureModel(containerId, options);
              }
            }
          },
          { label: 'Hide all siblings to the right', action: () => {
              if (parentModelNode && siblings.length > 1 && idx >= 0 && idx < siblings.length - 1) {
                let indicesToHide = [];
                for (let i = idx + 1; i < siblings.length; ++i) indicesToHide.push(i);
                if (hiddenSiblingsMap[parentPath]) {
                  hiddenSiblingsMap[parentPath].forEach(group => {
                    group.forEach(i => { if (i > idx && !indicesToHide.includes(i)) indicesToHide.push(i); });
                  });
                }
                setHiddenSiblingsGroup(parentPath, siblings, indicesToHide);
                d3.selectAll('.custom-context-menu').remove();
                renderFeatureModel(containerId, options);
              }
            }
          },
          { separator: true },
          { label: 'Hide this node', action: () => {
              if (parentModelNode && siblings.length > 1 && idx >= 0) {
                let indicesToHide = [idx];
                if (hiddenSiblingsMap[parentPath]) {
                  hiddenSiblingsMap[parentPath].forEach(group => {
                    if (group.includes(idx - 1) || group.includes(idx + 1) || group.includes(idx)) {
                      group.forEach(i => { if (!indicesToHide.includes(i)) indicesToHide.push(i); });
                    }
                  });
                }
                setHiddenSiblingsGroup(parentPath, siblings, indicesToHide);
              } else {
                hiddenMap[path] = true;
              }
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId, options);
            }
          }
        ]}
      ];
      showContextMenu(event, actions);
    });

  // Add native SVG <title> for tooltip if name is shortened
  svgContent.selectAll('g.fme-node').each(function(d) {
    const name = d.data.name;
    const displayText = d._displayText;
    if (typeof name === 'string' && displayText !== name) {
      d3.select(this).append('title').text(name);
    }
  });

  // Only append rect/text to FeatureNode nodes
  svgContent.selectAll('g.node')
    .filter(d => d.data instanceof FeatureNode)
    .append('rect')
    .attr('width', d => d._rectWidth)
    .attr('height', rectHeight)
    .attr('x', d => -d._rectWidth / 2)
    .attr('y', -rectHeight / 2)
    .attr('rx', 6)
    .attr('ry', 6);

  svgContent.selectAll('g.node')
    .filter(d => d.data instanceof FeatureNode)
    .append('text')
    .attr('dy', 5)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'inherit')
    .attr('class', d => {
      const attr = d.data.attr || [];
      let cls = '';
      if (attr.includes('dead')) cls += ' fme-node-dead';
      if (attr.includes('core')) cls += ' fme-node-core';
      return cls.trim();
    })
    .text(d => d._displayText);

  // Only append indicator graphics to IndicatorNode nodes
  svgContent.selectAll('g.node')
    .filter(d => d.data instanceof IndicatorNode)
    .each(function(d) {
      const { indicatorType, hiddenIndices } = d.data;
      const count = hiddenIndices ? hiddenIndices.length : 0;
      const g = d3.select(this);
      g.selectAll('*').remove(); // Clear any previous content
      g.style('cursor', 'pointer');
      g.classed('fme-noselect', true);
      if (indicatorType === 'left' || indicatorType === 'right') {
        const base = rectHeight;
        const halfBase = base / 2;
        g.classed('fme-hidden-siblings-indicator', true);
        if (indicatorType === 'left') {
          g.append('polygon')
            .attr('points', `${-halfBase},0 ${halfBase},${-rectHeight/2} ${halfBase},${rectHeight/2}`);
          g.append('text')
            .attr('x', 0.4*halfBase)
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .text(count > 9 ? '9+' : count);
        } else {
          g.append('polygon')
            .attr('points', `${halfBase},0 ${-halfBase},${-rectHeight/2} ${-halfBase},${rectHeight/2}`);
          g.append('text')
            .attr('x', -0.4*halfBase)
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .text(count > 9 ? '9+' : count);
        }
      } else {
        const diamondSize = rectHeight/2;
        g.classed('fme-hidden-between-indicator', true);
        g.append('polygon')
          .attr('points', `0,${-diamondSize} ${diamondSize},0 0,${diamondSize} ${-diamondSize},0`);
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .text(count > 9 ? '9+' : count);
      }
    });

  // Draw node markers (mandatory/optional) after nodes so they appear above
  root.descendants().forEach(parent => {
    if (!parent.children || parent.children.length < 1) return;
    const realChildren = parent.children.filter(child => !(child.data instanceof IndicatorNode));
    if (!realChildren.length) return;
    const types = realChildren.map(child => child.data.type);
    const allMandatoryOptional = types.every(t => t === 'mandatory' || t === 'optional');
    const allOr = types.every(t => t === 'or');
    const allXor = types.every(t => t === 'xor');
    if (allOr || allXor) {
      drawGroupArc(parent, realChildren, allOr ? 'or' : 'xor', direction, rectWidth, rectHeight, svgContent);
    } else if (allMandatoryOptional) {
      const links = realChildren.map(child => ({ source: parent, target: child }));
      svgContent.selectAll('circle.fme-mandatory-marker-' + parent.data.name)
        .data(links.filter(d => d.target.data.type === 'mandatory'))
        .enter()
        .append('circle')
        .attr('class', 'fme-mandatory-marker')
        .attr('r', 6)
        .attr('cx', d => direction === 'v' ? d.target.x : d.target.x - (d.target._rectWidth || rectWidth) / 2)
        .attr('cy', d => direction === 'v' ? d.target.y - (d.target._rectHeight || rectHeight) / 2 : d.target.y)
        .raise();
      svgContent.selectAll('circle.fme-optional-marker-' + parent.data.name)
        .data(links.filter(d => d.target.data.type === 'optional'))
        .enter()
        .append('circle')
        .attr('class', d => {
          let cls = 'fme-optional-marker';
          if (d.target.data.attr && d.target.data.attr.includes('false-optional')) cls += ' fme-false-optional';
          return cls;
        })
        .attr('r', 6)
        .attr('cx', d => direction === 'v' ? d.target.x : d.target.x - (d.target._rectWidth || rectWidth) / 2)
        .attr('cy', d => direction === 'v' ? d.target.y - (d.target._rectHeight || rectHeight) / 2 : d.target.y)
        .raise();
    }
  });

  // After drawing nodes, add hint for collapsed nodes with hidden children
  root.descendants().forEach(node => {
    const path = getNodePath(node);
    if (collapsedMap[path]) {
      // Find the original FeatureNode for this path
      const featureNode = getModelNodeByPath(options.model, path);
      if (featureNode && featureNode.children && featureNode.children.length > 0) {
        // Count all descendants in the original model
        let count = 0;
        function countDescendants(n) {
          if (n.children) {
            n.children.forEach(child => {
              count++;
              countDescendants(child);
            });
          }
        }
        countDescendants(featureNode);
        // Count direct children by type
        const typeCounts = { mandatory: 0, optional: 0, or: 0, xor: 0 };
        featureNode.children.forEach(child => {
          if (typeCounts.hasOwnProperty(child.type)) typeCounts[child.type]++;
        });
        // Compute max depth
        function maxDepth(n) {
          if (!n.children || n.children.length === 0) return 0;
          return 1 + Math.max(...n.children.map(maxDepth));
        }
        const depth = maxDepth(featureNode);
        // Build type info table rows, only for types with count > 0
        const typeLabels = {
          mandatory: 'mandatory',
          optional: 'optional',
          or: 'or',
          xor: 'xor'
        };
        const typeInfoRows = Object.entries(typeCounts)
          .filter(([type, count]) => count > 0)
          .map(([type, count]) => `<tr class='tooltip-type-row'><td style='padding-left:24px;'>${typeLabels[type]}</td><td class='tooltip-type-count'>${count}</td></tr>`)
          .join('');
        // Draw badge and text in a single group
        const badgeWidth = 32, badgeHeight = 20;
        const badgeGroup = svgContent.append('g')
          .attr('transform', `translate(${node.x},${node.y + rectHeight / 2 + 16})`)
          .attr('class', 'fme-badge')
          .attr('data-node-name', node.data.name)
          .style('cursor', 'pointer')
          .on('mouseenter', function(event) {
            d3.selectAll('.badge-tooltip').remove();
            // Compute SVG position for tooltip (top-right of badge)
            const svg = document.querySelector(`#${containerId} svg`);
            const badgeRect = this.getBoundingClientRect();
            const tooltip = d3.select('body').append('div')
              .attr('class', 'badge-tooltip')
              .style('position', 'fixed')
              .style('left', `${badgeRect.right}px`)
              .style('top', `${badgeRect.top}px`)
              .style('pointer-events', 'none')
              .style('z-index', 10001)
              .html(`
                <div style='font-weight:bold; margin-bottom:8px;'>Hidden Subtree Info</div>
                <table class='tooltip-table'>
                  <tr>
                    <td style='vertical-align:top;'>Direct Features:</td>
                    <td style='vertical-align:top;'>${featureNode.children.length}</td>
                  </tr>
                  ${typeInfoRows}
                  <tr class='tooltip-table-sep'>
                    <td>Total Levels:</td>
                    <td>${depth}</td>
                  </tr>
                  <tr>
                    <td>Total Features:</td>
                    <td>${count}</td>
                  </tr>
                </table>
              `);
          })
          .on('mouseleave', function() {
            d3.selectAll('.badge-tooltip').remove();
          });
        badgeGroup.append('rect')
          .attr('x', -badgeWidth / 2)
          .attr('y', -badgeHeight / 2)
          .attr('width', badgeWidth)
          .attr('height', badgeHeight)
          .attr('rx', 0)
          .attr('ry', 0)
          .attr('class', 'fme-badge-rect');
        badgeGroup.append('text')
          .attr('y', 6)
          .attr('class', 'fme-badge-text')
          .text(count);
      }
    }
  });

  // Add hidden siblings indicators
  root.descendants().forEach(node => {
    const path = getNodePath(node);
    const featureNode = getModelNodeByPath(options.model, path);
    if (featureNode && featureNode.children && featureNode.children.length > 1) {
      const siblings = featureNode.children;
      const groups = (hiddenSiblingsMap[path] || []);
      groups.forEach((group, groupIdx) => {
        if (!group.length) return;
        const sorted = group.slice().sort((a, b) => a - b);
        const firstIdx = sorted[0];
        const lastIdx = sorted[sorted.length - 1];
        // Determine indicator type
        let indicatorType = 'diamond';
        if (firstIdx === 0) indicatorType = 'left';
        else if (lastIdx === siblings.length - 1) indicatorType = 'right';
        // Find anchor node for indicator position
        let anchor = null;
        if (indicatorType === 'left') {
          // First visible node after group
          anchor = node.children && node.children.length > 0 ? node.children[0] : node;
        } else if (indicatorType === 'right') {
          anchor = node.children && node.children.length > 0 ? node.children[node.children.length - 1] : node;
        } else {
          // Find visible node before and after group
          let before = null, after = null;
          for (let i = firstIdx - 1; i >= 0; i--) {
            const name = siblings[i].name;
            before = (node.children || []).find(vc => vc.data.name === name);
            if (before) break;
          }
          for (let i = lastIdx + 1; i < siblings.length; i++) {
            const name = siblings[i].name;
            after = (node.children || []).find(vc => vc.data.name === name);
            if (after) break;
          }
          if (before && after) {
            anchor = { x: (before.x + after.x) / 2, y: before.y };
          } else if (before) {
            anchor = { x: before.x + (before._rectWidth || rectWidth) / 2 + 15, y: before.y };
          } else if (after) {
            anchor = { x: after.x - (after._rectWidth || rectWidth) / 2 - 15, y: after.y };
          } else {
            anchor = node;
          }
        }
        
      });
    }
  });

  // After rendering, center the root node in the SVG viewport on first render
  const zoom = setupZoom(svg, svgContent, width, height);
  if (isFirstRender || forceInitialView) {
    const centerX = width / 2;
    const tenPercentY = height * 0.1;
    const nodeOffsetX = rectWidth / 2;
    const nodeOffsetY = rectHeight / 2;
    const initialTransform = d3.zoomIdentity.translate(centerX - nodeOffsetX, tenPercentY - nodeOffsetY);
    initialTransformGlobal = initialTransform;
    svg.call(zoom.transform, initialTransform);
    // Reset legend to initial position
    const legend = document.getElementById('fme-legend');
    if (legend) {
      delete legend.dataset.userMoved;
      legend.style.left = '';
      legend.style.top = '';
    }
    positionLegendAuto(containerId);
    isFirstRender = false;
    forceInitialView = false;
  } else if (prevRootScreenPos) {
    // After re-render, get new root node SVG position
    const newRootSVG = { x: rectWidth / 2, y: rectHeight / 2 };
    // Compute the transform needed to place newRootSVG at prevRootScreenPos
    // Use previous scale
    const scale = currentTransform.k;
    const dx = prevRootScreenPos.x - newRootSVG.x * scale;
    const dy = prevRootScreenPos.y - newRootSVG.y * scale;
    const newTransform = d3.zoomIdentity.translate(dx, dy).scale(scale);
    svg.call(zoom.transform, newTransform);
    currentTransform = newTransform;
  }

  // Inject improved context menu styles if not already present
  // (Removed: CSS is now in css/style.css)

  // After rendering, position legend next to tree bounding box
  positionLegendAuto(containerId);
  setTimeout(() => { updateLegendVisibility(root); }, 0);

  // --- Store model and collapsedMap for API/demo use ---
  if (typeof window !== 'undefined') {
    window.FME = window.FME || {};
    window.FME.__featureModelRoot = featureModelRoot;
    window.FME.__collapsedMap = { ...collapsedMap };
    window.FME.__hiddenMap = { ...hiddenMap };
    window.FME.__hiddenSiblingsMap = { ...hiddenSiblingsMap };
  }

  // --- Add context menu to SVG surface ---
  svg.on('contextmenu', function(event) {
    if (event.target.closest('g.fme-node')) return;
    const actions = [
      { label: 'Reset view', action: () => { resetView(svg, svgContent, width, height, containerId, true, options); } },
      { separator: true },
      { label: 'Theme', submenu: [
        {
          label: 'FeatureIDE',
          action: () => {
            if (currentTheme !== 'featureide') {
              toggleTheme('featureide');
            }
          },
          checked: currentTheme === 'featureide'
        },
        {
          label: 'Neon Genesis Evangelion',
          action: () => {
            if (currentTheme !== 'nge') {
              toggleTheme('nge');
            }
          },
          checked: currentTheme === 'nge'
        },
        {
          label: 'Kandinsky-inspired',
          action: () => {
            if (currentTheme !== 'kandinsky') {
              toggleTheme('kandinsky');
            }
          },
          checked: currentTheme === 'kandinsky'
        }
      ] },
      { separator: true },
      { label: 'Export as', submenu: [
        { label: 'SVG', action: () => exportAsSVG() },
        { label: 'PNG', action: () => exportAsPNG(true) },
      ] },
      { label: 'Export w/o legend as', submenu: [
        { label: 'SVG', action: () => exportAsSVG() },
        { label: 'PNG', action: () => exportAsPNG(false) },
      ] },
    ];
    showContextMenu(event, actions);
  });
}

function drawGroupArc(parent, group, type, direction, rectWidth, rectHeight, svgContent) {
  const { cx, cy, r, startAngle, endAngle } = getArcAngles(parent, group, direction, rectWidth, rectHeight);
  const pathData = describeFilledArc(cx, cy, r, startAngle, endAngle);
  svgContent.append('path')
    .attr('class', type === 'or' ? 'fme-or-group-arc' : 'fme-alt-group-arc')
    .attr('d', pathData);
}

// Utility to describe a filled SVG arc (pie slice)
function describeFilledArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M', cx, cy,
    'L', start.x, start.y,
    'A', r, r, 0, largeArcFlag, 0, end.x, end.y,
    'Z'
  ].join(' ');
}

function polarToCartesian(cx, cy, r, angle) {
  const rad = (angle - 90) * Math.PI / 180.0;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

// Helper to calculate arc center, radius, and angles
function getArcAngles(parent, children, direction, rectWidth, rectHeight) {
  const getWidth = n => n.data && n.data._rectWidth ? n.data._rectWidth : (n._rectWidth || rectWidth);
  const parentWidth = parent._rectWidth || rectWidth;
  const first = children[0];
  const middle = children[Math.floor(children.length / 2)];
  const last = children[children.length - 1];
  let cx, cy, r, angleTo, startAngle, endAngle;
  // Get level distance from global or fallback
  const maxLevelDistance = (typeof window !== 'undefined' && window.__FM_LEVEL_DISTANCE) ? window.__FM_LEVEL_DISTANCE : 100;
  const maxSiblingDistance = (typeof window !== 'undefined' && window.__FM_SIBLING_DISTANCE) ? window.__FM_SIBLING_DISTANCE : 25;
  if (direction === 'v') {
    cx = parent.x;
    cy = parent.y + rectHeight / 2;
    const childY = middle.y - rectHeight / 2;
    r = Math.max(24, childY - cy - 8);
    r = Math.min(r, maxLevelDistance / 3);
    angleTo = (child) => {
      const dx = child.x - cx;
      const dy = (child.y - rectHeight / 2) - cy;
      return Math.atan2(dy, dx) * 180 / Math.PI + 90;
    };
    startAngle = angleTo(first);
    endAngle = angleTo(last);
    if (endAngle < startAngle) [startAngle, endAngle] = [endAngle, startAngle];
  } else {
    cx = parent.x + parentWidth / 2;
    cy = parent.y;
    const childX = middle.x - getWidth(middle) / 2;
    r = Math.max(24, childX - cx - 8);
    r = Math.min(r, maxSiblingDistance / 4);
    angleTo = (child) => {
      const dx = (child.x - getWidth(child) / 2) - cx;
      const dy = child.y - cy;
      return Math.atan2(dy, dx) * 180 / Math.PI + 90;
    };
    startAngle = angleTo(first);
    endAngle = angleTo(last);
    if (endAngle < startAngle) [startAngle, endAngle] = [endAngle, startAngle];
  }
  return { cx, cy, r, startAngle, endAngle };
}


export function FeatureModelRenderer(options = {}) {
  let container = options.container || '#app';
  if (container.startsWith('#')) container = container.slice(1);
  // Set defaults if not provided
  const opts = {
    orientation: typeof options.orientation === 'string' ? options.orientation : 'v',
    grow_x: typeof options.grow_x === 'number' ? options.grow_x : 25,
    grow_y: typeof options.grow_y === 'number' ? options.grow_y : 100,
    container: container,
    model: options.model
  };
  renderFeatureModel(container, opts);
}

// Attach to window for global usage if not running as a module
if (typeof window !== 'undefined') {
  window.FME = window.FME || {};
  window.FME.FeatureModelRenderer = FeatureModelRenderer;
}

// --- Rename input overlay logic ---
function showRenameInput(d, modelNode, siblings, idx, containerId, options) {
  // Remove any existing rename input
  const oldInput = document.getElementById('rename-input-box');
  if (oldInput) oldInput.remove();

  // Find SVG rect element for this node
  const svg = document.querySelector(`#${containerId} svg`);
  // Find the node's group element
  const nodeG = Array.from(svg.querySelectorAll('g.fme-node')).find(g => {
    const text = g.querySelector('text');
    return text && text.textContent === d._displayText;
  });
  if (!nodeG) return;
  const rectElem = nodeG.querySelector('rect');
  if (!rectElem) return;
  const rectBox = rectElem.getBoundingClientRect();

  // Create input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = modelNode.name;
  input.id = 'rename-input-box';
  input.className = 'fme-rename-input';
  input.style.left = `${rectBox.left}px`;
  input.style.top = `${rectBox.top}px`;
  input.style.width = `${rectBox.width}px`;
  input.style.height = `${rectBox.height}px`;
  input.style.fontSize = '15px';
  input.style.fontFamily = 'monospace';
  input.style.zIndex = 10001;
  input.style.padding = '0 8px';
  input.style.border = '2px solid #1976d2';
  input.style.borderRadius = '6px';
  input.style.background = '#fff';
  input.style.boxShadow = '0 2px 8px rgba(0,0,0,0.13)';
  input.style.outline = 'none';
  input.style.textAlign = 'center';

  document.body.appendChild(input);
  input.focus();
  input.select();

  // Helper: check uniqueness among siblings
  function isUniqueName(name) {
    return siblings.every((s, i) => i === idx || s.name !== name);
  }

  // Remove input utility
  function removeInput() {
    if (input.parentNode) input.parentNode.removeChild(input);
  }

  // Handle key events
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const newName = input.value.trim();
      if (!newName) {
        input.classList.add('fme-rename-error');
        return;
      }
      if (!isUniqueName(newName)) {
        input.classList.add('fme-rename-error');
        return;
      }
      // Commit rename
      modelNode.name = newName;
      removeInput();
      renderFeatureModel(containerId, options);
    } else if (e.key === 'Escape') {
      removeInput();
    }
  });
  input.addEventListener('input', function() {
    input.classList.remove('fme-rename-error');
  });
  // Remove input if focus lost
  input.addEventListener('blur', function() {
    setTimeout(removeInput, 100);
  });
}

// --- Public API: Highlight features by names (including collapsed subtree logic) ---
// Usage: window.FME.highlightFeaturesByNames(["FeatureA", "FeatureB"])
function highlightFeaturesByNames(featureNames) {
  // Remove previous highlights
  document.querySelectorAll('.fme-highlight').forEach(n => n.classList.remove('fme-highlight'));
  // Get the current model tree and collapsedMap
  const featureModelRoot = window.FME && window.FME.__featureModelRoot ? window.FME.__featureModelRoot : undefined;
  const collapsedMap = window.FME && window.FME.__collapsedMap ? window.FME.__collapsedMap : undefined;
  if (!featureModelRoot || !collapsedMap) return;
  // Helper: recursively check if a node or any descendant has a given name
  function subtreeContainsFeature(node, name) {
    if (!node) return false;
    if (node.name === name) return true;
    if (node.children) {
      for (const child of node.children) {
        if (subtreeContainsFeature(child, name)) return true;
      }
    }
    return false;
  }
  // Highlight visible nodes whose text matches (direct matches only)
  document.querySelectorAll('.fme-node text').forEach(t => {
    if (featureNames.includes(t.textContent)) {
      t.closest('.fme-node').classList.add('fme-highlight');
    }
  });
  // Highlight badges for visible nodes whose collapsed subtrees contain a relevant feature (but do NOT highlight the node itself)
  document.querySelectorAll('.fme-node').forEach(nodeElem => {
    const textElem = nodeElem.querySelector('text');
    if (!textElem) return;
    const nodeName = textElem.textContent;
    // Find the node in the model tree by name (assume unique names)
    function findNodeByName(node, name) {
      if (node.name === name) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNodeByName(child, name);
          if (found) return found;
        }
      }
      return null;
    }
    const modelNode = findNodeByName(featureModelRoot, nodeName);
    if (!modelNode) return;
    // Compute path for this node
    let path = 'root';
    let n = modelNode;
    const pathParts = [];
    while (n && n.name && n !== featureModelRoot) {
      pathParts.unshift(n.name);
      // Find parent (inefficient, but ok for demo)
      function findParent(root, child) {
        if (!root.children) return null;
        for (const c of root.children) {
          if (c === child) return root;
          const found = findParent(c, child);
          if (found) return found;
        }
        return null;
      }
      n = findParent(featureModelRoot, n);
    }
    if (pathParts.length > 0) path += '/' + pathParts.join('/');
    if (collapsedMap[path]) {
      let subtreeMatch = false;
      for (const fname of featureNames) {
        // Only highlight badge, not node, for subtree matches
        if (subtreeContainsFeature(modelNode, fname)) {
          subtreeMatch = true;
          break;
        }
      }
      // Highlight the badge if subtreeMatch
      if (subtreeMatch) {
        const badge = document.querySelector(`.fme-badge[data-node-name="${nodeName}"]`);
        if (badge) badge.classList.add('fme-highlight');
      }
    }
  });
}
// Attach to window for demo and external use
if (typeof window !== 'undefined') {
  window.FME = window.FME || {};
  window.FME.highlightFeaturesByNames = highlightFeaturesByNames;
}

// --- Public API: Create constraints panel ---
function createConstraintsPanel(containerId, constraints) {
  let panel = document.getElementById('fme-constraints-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'fme-constraints-panel';
    panel.className = 'fme-constraints-panel';
    panel.innerHTML = `
      <div class="fme-constraints-panel-header">Constraints</div>
      <ul class="fme-constraints-list"></ul>
    `;
    document.getElementById(containerId).appendChild(panel);
    
    // Resizing logic
    let isResizing = false, startY = 0, startHeight = 0;
    const header = panel.querySelector('.fme-constraints-panel-header');
    header.addEventListener('mousedown', function(e) {
      isResizing = true;
      startY = e.clientY;
      startHeight = panel.offsetHeight;
      panel.classList.add('fme-cursor-ns-resize');
      document.body.classList.add('fme-cursor-ns-resize');
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      const dy = startY - e.clientY;
      let newHeight = startHeight + dy;
      newHeight = Math.max(40, Math.min(window.innerHeight * 0.5, newHeight));
      panel.style.height = newHeight + 'px';
    });
    document.addEventListener('mouseup', function() {
      isResizing = false;
      panel.classList.remove('fme-cursor-ns-resize');
      document.body.classList.remove('fme-cursor-ns-resize');
    });
  }
  
  // Update constraints list
  const list = panel.querySelector('.fme-constraints-list');
  list.innerHTML = '';
  
  if (constraints && constraints.length > 0) {
    constraints.forEach((c, i) => {
      // Remove single quotes from feature names for display
      const displayConstraint = c.replace(/'([^']+)'/g, "$1");
      const li = document.createElement('li');
      li.className = 'fme-constraint-item';
      li.textContent = displayConstraint;
      
      // Highlight features on hover
      li.addEventListener('mouseenter', () => {
        // Extract all feature names from the constraint
        const featureNames = Array.from(c.matchAll(/'([^']+)'/g)).map(m => m[1]);
        if (window.FME && typeof window.FME.highlightFeaturesByNames === 'function') {
          window.FME.highlightFeaturesByNames(featureNames);
        }
      });
      li.addEventListener('mouseleave', () => {
        document.querySelectorAll('.fme-highlight').forEach(n => n.classList.remove('fme-highlight'));
      });
      list.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'fme-no-constraints';
    li.textContent = '(No constraints)';
    list.appendChild(li);
  }
}

// Attach to window for demo and external use
if (typeof window !== 'undefined') {
  window.FME = window.FME || {};
  window.FME.highlightFeaturesByNames = highlightFeaturesByNames;
  window.FME.createConstraintsPanel = createConstraintsPanel;
}

// Utility: robustly merge and update hidden sibling groups
function setHiddenSiblingsGroup(parentPath, siblings, indicesToHide) {
  // indicesToHide: array of indices in siblings to hide
  if (!hiddenSiblingsMap[parentPath]) hiddenSiblingsMap[parentPath] = [];
  // Remove any overlapping/adjacent groups
  let newGroup = indicesToHide.slice().sort((a, b) => a - b);
  // Remove duplicates
  newGroup = Array.from(new Set(newGroup));
  // Remove from hiddenSiblingsMap any group that overlaps or is adjacent
  hiddenSiblingsMap[parentPath] = (hiddenSiblingsMap[parentPath] || []).filter(group => {
    const minIdx = Math.min(...group);
    const maxIdx = Math.max(...group);
    if (newGroup.some(idx => idx >= minIdx - 1 && idx <= maxIdx + 1)) {
      // Overlaps or adjacent
      return false;
    }
    return true;
  });
  // Add the new group
  hiddenSiblingsMap[parentPath].push(newGroup);
  // Update hiddenMap for all nodes in the group
  newGroup.forEach(idx => {
    const sibPath = parentPath + '/' + siblings[idx].name;
    hiddenMap[sibPath] = true;
  });
} 