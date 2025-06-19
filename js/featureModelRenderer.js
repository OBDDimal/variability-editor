import * as d3 from 'd3';
import { FeatureNode } from './featureNode.js';

// Example: Root has mandatory/optional children, Feature B has only xor children
const featureModelRoot = new FeatureNode('Root', {
  children: [
    new FeatureNode('Feature A', { type: 'mandatory' }),
    new FeatureNode('Feature B', {
      type: 'mandatory',
      children: [
        new FeatureNode('Feature B1', { type: 'or', attr: ["dead"] }),
        new FeatureNode('Feature B2', { type: 'or', attr: ["core"]  }),
        new FeatureNode('Feature B3', { type: 'or' }),
        new FeatureNode('Feature B4', { type: 'or' }),
        new FeatureNode('Feature B5', { type: 'or' }),
      ]
    }),
    new FeatureNode('Feature C', { type: 'optional', attr: ["false-optional"] })
  ]
});

let direction = 'v'; // 'v' = vertical, 'h' = horizontal
const rectWidth = 100;
const rectHeight = 30;

// Track collapsed state by node path
let collapsedMap = {};
let levelDistance = 100;
let resizeListenerSet = false;
let siblingDistance = 25;
let currentTransform = d3.zoomIdentity;
let isFirstRender = true;
let initialTransformGlobal = null;
let forceInitialView = false;

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

function ensureLevelDistanceInput(containerId) {
  let input = document.getElementById('level-distance-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'number';
    input.id = 'level-distance-input';
    input.min = 50;
    input.max = 200;
    input.value = levelDistance;
    input.style.position = 'absolute';
    input.style.top = '50px';
    input.style.right = '10px';
    input.style.width = '60px';
    input.title = 'Level distance';
    input.onchange = (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val)) val = 50;
      val = Math.max(50, Math.min(200, val));
      levelDistance = val;
      input.value = val;
      renderFeatureModel(containerId);
    };
    document.body.appendChild(input);
  }
}

function ensureSiblingDistanceInput(containerId) {
  let input = document.getElementById('sibling-distance-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'number';
    input.id = 'sibling-distance-input';
    input.min = 5;
    input.max = 200;
    input.value = siblingDistance;
    input.style.position = 'absolute';
    input.style.top = '90px';
    input.style.right = '10px';
    input.style.width = '60px';
    input.title = 'Sibling distance';
    input.onchange = (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val)) val = 25;
      val = Math.max(5, Math.min(200, val));
      siblingDistance = val;
      input.value = val;
      renderFeatureModel(containerId);
    };
    document.body.appendChild(input);
  }
}

function setupZoom(svg, svgContent, width, height) {
  const zoom = d3.zoom()
    .scaleExtent([0.5, 2])
    .filter(event => {
      // Only allow wheel for zoom, and left mouse for pan
      return event.type === 'wheel' || (event.type === 'mousedown' && event.button === 0);
    })
    .on('start', function() {
      svg.classed('grabbed', true).classed('grabbable', false);
    })
    .on('zoom', (event) => {
      svgContent.attr('transform', event.transform);
      currentTransform = event.transform;
    })
    .on('end', function() {
      svg.classed('grabbed', false).classed('grabbable', true);
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
  const legend = document.getElementById('legend');
  if (!legend) return;
  if (legend.dataset.userMoved === 'true') return;
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
  legend.style.left = (screenPt.x + 100) + 'px';
  legend.style.top = (screenPt.y) + 'px';
  legend.dataset.userMoved = 'true'
}

function ensureLegend() {
  if (document.getElementById('legend')) return;
  const legend = document.createElement('div');
  legend.id = 'legend';
  legend.innerHTML = `
    <div class="legend-drag-handle">Legend</div>
    <div class="legend-content">
      <div class="legend-row-single" data-legend-type="base"><svg width="160" height="40"><g class="node legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Feature</text></g></svg></div>
      <div class="legend-row-single" data-legend-type="abstract"><svg width="160" height="40"><g class="node legend abstract"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Abstract Feature</text></g></svg></div>
      <div class="legend-row-single" data-legend-type="mandatory"><svg width="160" height="40"><g class="node legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><circle cx="80" cy="10" r="5" class="mandatory-marker"/><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Mandatory Feature</text></g></svg></div>
      <div class="legend-row-single" data-legend-type="optional"><svg width="160" height="40"><g class="node legend"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><circle cx="80" cy="10" r="5" class="optional-marker"/><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Optional Feature</text></g></svg></div>
      <div class="legend-sep"></div>
      <div class="legend-row-single" data-legend-type="core"><svg width="160" height="40"><g class="node legend core"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Core Feature</text></g></svg></div>
      <div class="legend-row-single" data-legend-type="dead"><svg width="160" height="40"><g class="node legend dead"><rect width="150" height="24" x = "5" y="10" rx="6" ry="6"></rect><text dx = "80" dy="27.5" text-anchor="middle" font-family="inherit" class="">Dead Feature</text></g></svg></div>
      <div class="legend-sep"></div>
      <div class="legend-row-double" data-legend-type="alt-group"><div class="legend-col-icon"><svg width="40" height="40"><path d="M20,10 L3,30 Z M20,10 L37,30 Z" class = "edge"/><path d="M20,10 L8,25 A20,40 0 0,0 32,25 Z" class = "alt-group-arc" /></svg></div><div class = "legend-col-label">Alternative Group</div></div>
      <div class="legend-row-double" data-legend-type="or-group"><div class="legend-col-icon"><svg width="40" height="40"><path d="M20,10 L3,30 Z M20,10 L37,30 Z" class = "edge"/><path d="M20,10 L8,25 A20,40 0 0,0 32,25 Z" class = "or-group-arc" /></svg></div><div class = "legend-col-label">Or Group</div></div>
      <div class="legend-row-double" data-legend-type="false-optional"><div class="legend-col-icon"><svg width="32" height="18"><line x1="4" y1="9" x2="22" y2="9" stroke="#d32f2f" stroke-width="2"/><circle cx="26" cy="9" r="5" fill="#fff" stroke="#d32f2f" stroke-width="2"/></svg></div><div class="legend-col-label">False-Optional</div></div>
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
    legend.classList.add('dragging');
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    legend.style.left = (e.clientX - offsetX) + 'px';
    legend.style.top = (e.clientY - offsetY) + 'px';
    legend.dataset.userMoved = 'true';
  });
  document.addEventListener('mouseup', () => {
    isDragging = false;
    legend.classList.remove('dragging');
    document.body.style.userSelect = '';
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
  // root is a d3.hierarchy node in renderFeatureModel
  scan(d3.hierarchy(featureModelRoot.toObject()));
  // Show/hide base legend item
  const baseRow = document.querySelector('#legend [data-legend-type="base"]');
  if (baseRow) {
    if (visibleNodeCount === 1) {
      baseRow.style.display = '';
    } else {
      baseRow.style.display = 'none';
    }
  }
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
  document.querySelectorAll('#legend [data-legend-type]').forEach(row => {
    const type = row.getAttribute('data-legend-type');
    if (type === 'base') return; // already handled
    const key = legendMap[type];
    if (key && present[key]) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
  // Hide legend-sep divs that do not separate two visible legend entries
  document.querySelectorAll('#legend .legend-sep').forEach(sep => {
    // Find previous and next visible legend rows
    let prev = sep.previousElementSibling;
    while (prev && (prev.style.display === 'none' || !prev.matches('[data-legend-type]'))) prev = prev.previousElementSibling;
    let next = sep.nextElementSibling;
    while (next && (next.style.display === 'none' || !next.matches('[data-legend-type]'))) next = next.nextElementSibling;
    if (prev && next) {
      sep.style.display = '';
    } else {
      sep.style.display = 'none';
    }
  });
  // Hide any .legend-sep that immediately follows another visible .legend-sep
  let lastWasSep = false;
  document.querySelectorAll('#legend .legend-content > *').forEach(row => {
    if (row.classList.contains('legend-sep') && row.style.display !== 'none') {
      if (lastWasSep) {
        row.style.display = 'none';
      }
      lastWasSep = true;
    } else if (row.style.display !== 'none') {
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
        menuSel.append('div').attr('class', 'menu-separator').style('height', '1px').style('background', '#eee').style('margin', '4px 0');
        return;
      }
      const itemDiv = menuSel.append('div')
        .datum(a)
        .attr('class', function() {
          if (isMain) {
            let isActive = (i === activeIndex) && menu.node() === document.activeElement;
            return 'menu-item' + (isActive ? ' active' : '');
          } else {
            return 'menu-item' + (i === submenuActiveIndex && menuSel.node() === document.activeElement ? ' active' : '');
          }
        })
        .attr('tabindex', -1)
        .style('padding', '8px 20px 8px 16px')
        .style('cursor', 'pointer')
        .style('display', 'flex')
        .style('align-items', 'center')
        .on('click', (e, a2) => {
          if (a2.submenu) {
            // Do nothing, handled by hover
          } else if (a2.action) {
            closeMenus();
            a2.action();
          }
        })
        .html(function(a2) {
          return a2.label + (a2.submenu ? '<span class="submenu-arrow">&#9654;</span>' : '');
        });
      // Render submenu as child div if present
      if (a.submenu && Array.isArray(a.submenu)) {
        const submenuDiv = itemDiv.append('div')
          .attr('class', 'custom-context-menu submenu')
          .style('position', 'absolute')
          .style('left', '100%')
          .style('top', '0')
          .style('display', 'none');
        // RECURSIVE call
        renderMenuItems(submenuDiv, a.submenu, false);
        // Show submenu on hover/focus
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
function resetView(svg, svgContent, width, height, containerId, shouldUncollapse = false) {
  if (shouldUncollapse) {
    collapsedMap = {};
    forceInitialView = true;
    renderFeatureModel(containerId);
    return;
  }
  // Fallback: just trigger a full re-render as on initial
  forceInitialView = true;
  renderFeatureModel(containerId);
}

// --- Legend Auto-Position Utility ---
function positionLegendAuto(containerId) {
  setTimeout(() => {
    const legend = document.getElementById('legend');
    if (legend) {
      positionLegendNextToTreeBBox(containerId);
    }
  }, 0);
}

// --- Export Utilities ---
function exportAsSVG() {
  // Get the main SVG
  const svgElem = document.querySelector('.main-svg');
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
      // Remove everything before .main-svg
      const idx = css.indexOf('.main-svg');
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
      const nodeRects = Array.from(svgElem.querySelectorAll('g.node rect'));
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

export function renderFeatureModel(containerId = 'app') {
  ensureLegend();
  // Save current transform if SVG exists
  const oldSvg = d3.select(`#${containerId} svg`);
  let prevRootScreenPos = null;
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
  const width = container.offsetWidth || 800;
  const height = container.offsetHeight || 600;

  ensureLevelDistanceInput(containerId);
  ensureSiblingDistanceInput(containerId);

  // Set up resize listener once
  if (!resizeListenerSet) {
    window.addEventListener('resize', () => {
      renderFeatureModel(containerId);
    });
    resizeListenerSet = true;
  }

  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .classed('main-svg', true)
    .classed('grabbable', true);

  const svgContent = svg.append('g').attr('id', 'draggable');

  // Directional layout
  const treeLayout = d3.tree().nodeSize(
    direction === 'v'
      ? [rectWidth + siblingDistance, rectHeight + levelDistance]
      : [rectHeight + siblingDistance, rectWidth + levelDistance]
  );
  // treeLayout.separation(() => 1);

  // Build hierarchy with collapsed filtering
  function filterCollapsed(node) {
    if (collapsedMap[getNodePath(node)]) {
      node.children = null;
    } else if (node.children) {
      node.children.forEach(filterCollapsed);
    }
  }
  const root = d3.hierarchy(featureModelRoot.toObject());
  filterCollapsed(root);
  treeLayout(root);

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
  svgContent.selectAll('line.link')
    .data(root.links())
    .enter()
    .append('line')
    .attr('class', d => {
      let cls = 'edge';
      if (d.target.data.attr && d.target.data.attr.includes('false-optional')) cls += ' edge-false-optional';
      return cls;
    })
    .attr('x1', d => direction === 'v' ? d.source.x + rectWidth / 2 : d.source.x + rectWidth / 2 + rectWidth / 2)
    .attr('y1', d => direction === 'v' ? d.source.y + rectHeight / 2 + rectHeight / 2 : d.source.y + rectHeight / 2)
    .attr('x2', d => direction === 'v' ? d.target.x + rectWidth / 2 : d.target.x + rectWidth / 2 - rectWidth / 2)
    .attr('y2', d => direction === 'v' ? d.target.y + rectHeight / 2 - rectHeight / 2 : d.target.y + rectHeight / 2);

  // Add red marker for false-optional edges
  svgContent.selectAll('circle.edge-false-optional-marker')
    .data(root.links().filter(d => d.target.data.attr && d.target.data.attr.includes('false-optional')))
    .enter()
    .append('circle')
    .attr('class', 'edge-false-optional-marker')
    .attr('r', 6)
    .attr('cx', d => direction === 'v' ? d.target.x + rectWidth / 2 : d.target.x + rectWidth / 2 - rectWidth / 2)
    .attr('cy', d => direction === 'v' ? d.target.y + rectHeight / 2 - rectHeight / 2 : d.target.y + rectHeight / 2);

  // Draw nodes (rects and text)
  const node = svgContent.selectAll('g.node')
    .data(root.descendants())
    .enter()
    .append('g')
    .attr('class', d => `node${d.data.abstract ? ' abstract' : ''}`)
    .attr('transform', d => `translate(${d.x + rectWidth / 2},${d.y + rectHeight / 2})`)
    .on('click', function(event, d) {
      event.stopPropagation();
      const path = getNodePath(d);
      collapsedMap[path] = !collapsedMap[path];
      renderFeatureModel(containerId);
    })
    .on('contextmenu', function(event, d) {
      event.preventDefault();
      d3.selectAll('.custom-context-menu').remove();
      const path = getNodePath(d);
      const featureNode = getFeatureNodeByPath(featureModelRoot, path);
      const parentNode = getParentFeatureNodeByPath(featureModelRoot, path);
      const actions = [
        { label: 'Change to', submenu: [
          { label: 'mandatory (feature)', action: () => { featureNode.type = 'mandatory'; d3.selectAll('.custom-context-menu').remove(); renderFeatureModel(containerId); } },
          { label: 'optional (feature)', action: () => { featureNode.type = 'optional'; d3.selectAll('.custom-context-menu').remove(); renderFeatureModel(containerId); } },
          { label: 'or (group)', action: () => {
              if (parentNode && parentNode.children) {
                parentNode.children.forEach(child => { child.type = 'or'; });
              } else {
                featureNode.type = 'or';
              }
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId);
            }
          },
          { label: 'xor (group)', action: () => {
              if (parentNode && parentNode.children) {
                parentNode.children.forEach(child => { child.type = 'xor'; });
              } else {
                featureNode.type = 'xor';
              }
              d3.selectAll('.custom-context-menu').remove();
              renderFeatureModel(containerId);
            }
          }
        ] },
        { label: 'Collapse below', action: () => {
            collapsedMap[path] = !collapsedMap[path];
            d3.selectAll('.custom-context-menu').remove();
            renderFeatureModel(containerId);
          }
        }
      ];
      showContextMenu(event, actions);
    });

  node.append('rect')
    .attr('width', rectWidth)
    .attr('height', rectHeight)
    .attr('x', -rectWidth / 2)
    .attr('y', -rectHeight / 2)
    .attr('rx', 6)
    .attr('ry', 6);

  node.append('text')
    .attr('dy', 5)
    .attr('text-anchor', 'middle')
    .attr('font-family', 'inherit')
    .attr('class', d => {
      const attr = d.data.attr || [];
      let cls = '';
      if (attr.includes('dead')) cls += ' node-dead';
      if (attr.includes('core')) cls += ' node-core';
      return cls.trim();
    })
    .text(d => d.data.name);

  // Draw node markers (mandatory/optional) after nodes so they appear above
  root.descendants().forEach(parent => {
    if (!parent.children || parent.children.length < 1) return;
    const types = parent.children.map(child => child.data.type);
    const allMandatoryOptional = types.every(t => t === 'mandatory' || t === 'optional');
    const allOr = types.every(t => t === 'or');
    const allXor = types.every(t => t === 'xor');
    if (allOr || allXor) {
      drawGroupArc(parent, parent.children, allOr ? 'or' : 'xor', direction, rectWidth, rectHeight, svgContent);
    } else if (allMandatoryOptional) {
      const links = parent.children.map(child => ({ source: parent, target: child }));
      svgContent.selectAll('circle.mandatory-marker-' + parent.data.name)
        .data(links.filter(d => d.target.data.type === 'mandatory'))
        .enter()
        .append('circle')
        .attr('class', 'mandatory-marker')
        .attr('r', 6)
        .attr('cx', d => direction === 'v' ? d.target.x + rectWidth / 2 : d.target.x + rectWidth / 2 - rectWidth / 2)
        .attr('cy', d => direction === 'v' ? d.target.y + rectHeight / 2 - rectHeight / 2 : d.target.y + rectHeight / 2)
        .raise();
      svgContent.selectAll('circle.optional-marker-' + parent.data.name)
        .data(links.filter(d => d.target.data.type === 'optional'))
        .enter()
        .append('circle')
        .attr('class', d => {
          let cls = 'optional-marker';
          if (d.target.data.attr && d.target.data.attr.includes('false-optional')) cls += ' false-optional';
          return cls;
        })
        .attr('r', 6)
        .attr('cx', d => direction === 'v' ? d.target.x + rectWidth / 2 : d.target.x + rectWidth / 2 - rectWidth / 2)
        .attr('cy', d => direction === 'v' ? d.target.y + rectHeight / 2 - rectHeight / 2 : d.target.y + rectHeight / 2)
        .raise();
    }
  });

  // After drawing nodes, add hint for collapsed nodes with hidden children
  root.descendants().forEach(node => {
    const path = getNodePath(node);
    if (collapsedMap[path]) {
      // Find the original FeatureNode for this path
      const featureNode = getFeatureNodeByPath(featureModelRoot, path);
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
          .attr('transform', `translate(${node.x + rectWidth / 2},${node.y + rectHeight / 2 + rectHeight / 2 + 16})`)
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
              .style('background', '#fff')
              .style('color', '#222')
              .style('padding', '12px 18px')
              .style('box-shadow', '0 4px 16px rgba(0,0,0,0.18)')
              .style('font-size', '15px')
              .style('font-family', 'sans-serif')
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
          .attr('fill', '#fffde7')
          .attr('stroke', '#bbb')
          .attr('stroke-width', 2)
          .attr('opacity', 1);
        badgeGroup.append('text')
          .attr('y', 6)
          .attr('text-anchor', 'middle')
          .attr('fill', '#111')
          .attr('font-size', 13)
          .attr('font-family', 'sans-serif')
          .text(count);
      }
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
    const legend = document.getElementById('legend');
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

  // Add direction toggle button (for MVP, simple button)
  addDirectionToggle(containerId);

  // Inject improved context menu styles if not already present
  if (!document.getElementById('custom-context-menu-style')) {
    const style = document.createElement('style');
    style.id = 'custom-context-menu-style';
    style.textContent = `
      .custom-context-menu {
        font-family: inherit;
        min-width: 180px;
        background: #fff;
        border: 1px solid #bbb;
        box-shadow: 0 4px 16px rgba(0,0,0,0.13);
        padding: 6px 0;
        z-index: 10000;
        user-select: none;
        transition: box-shadow 0.2s;
        position: absolute;
      }
      .custom-context-menu.submenu {
        box-shadow: 0 2px 8px rgba(0,0,0,0.10);
        margin-left: -2px;
        min-width: 180px;
        left: 100%;
        top: 0;
      }
      .custom-context-menu .menu-item {
        padding: 8px 20px 8px 16px;
        cursor: pointer;
        border: none;
        background: none;
        font-size: 15px;
        color: #222;
        outline: none;
        margin: 0 4px;
        transition: background 0.15s, color 0.15s;
        display: flex;
        align-items: center;
        position: relative;
      }
      .custom-context-menu .menu-item.active,
      .custom-context-menu .menu-item:hover,
      .custom-context-menu .menu-item:focus,
      .custom-context-menu .menu-item:focus-within {
        background: #f0f4fa;
        color: #1976d2;
      }
      .custom-context-menu .submenu-arrow {
        margin-left: auto;
        color: #1976d2;
        font-size: 15px;
        font-weight: bold;
        padding-left: 8px;
      }
      .custom-context-menu .submenu {
        display: none;
      }
      .custom-context-menu .menu-item:hover > .submenu,
      .custom-context-menu .menu-item:focus-within > .submenu {
        display: block;
      }
    `;
    document.head.appendChild(style);
  }

  // Add CSS for tooltip table and type count
  if (!document.getElementById('badge-tooltip-style')) {
    const style = document.createElement('style');
    style.id = 'badge-tooltip-style';
    style.textContent = `
      .badge-tooltip {
        transition: opacity 0.15s;
        pointer-events: none;
        max-width: 340px;
        line-height: 1.6;
        background: #fff;
        color: #222;
      }
      .badge-tooltip div { margin-bottom: 2px; }
      .badge-tooltip .tooltip-table {
        border-collapse: collapse;
        width: 100%;
      }
      .badge-tooltip .tooltip-table td {
        padding: 2px 8px 2px 0;
        text-align: left;
        vertical-align: top;
        font-size: 15px;
        font-family: sans-serif;
        border: none;
      }
      .badge-tooltip .tooltip-type-row td {
        font-size: 14px;
        color: #666;
        padding-top: 0;
        padding-bottom: 0;
      }
      .badge-tooltip .tooltip-type-row .tooltip-type-count {
        text-align: right;
        color: #888;
        font-variant-numeric: tabular-nums;
      }
      .badge-tooltip .tooltip-table-sep td {
        padding-top: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  // After rendering, position legend next to tree bounding box
  positionLegendAuto(containerId);
  setTimeout(() => { updateLegendVisibility(featureModelRoot); }, 0);

  // --- Add context menu to SVG surface ---
  svg.on('contextmenu', function(event) {
    if (event.target.closest('g.node')) return;
    const actions = [
      { label: 'Reset view', action: () => { resetView(svg, svgContent, width, height, containerId, true); } },
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
    .attr('class', type === 'or' ? 'or-group-arc' : 'alt-group-arc')
    .attr('d', pathData);
}

function addDirectionToggle(containerId) {
  if (document.getElementById('direction-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'direction-toggle';
  btn.textContent = 'Toggle Direction';
  btn.style.position = 'absolute';
  btn.style.top = '10px';
  btn.style.right = '10px';
  btn.onclick = () => {
    direction = direction === 'v' ? 'h' : 'v';
    renderFeatureModel(containerId);
  };
  document.body.appendChild(btn);
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
  const first = children[0];
  const middle = children[Math.floor(children.length / 2)];
  const last = children[children.length - 1];
  let cx, cy, r, angleTo, startAngle, endAngle;
  if (direction === 'v') {
    cx = parent.x + rectWidth / 2;
    cy = parent.y + rectHeight / 2 + rectHeight / 2;
    angleTo = (child) => {
      const dx = (child.x + rectWidth / 2) - cx;
      const dy = (child.y + rectHeight / 2 - rectHeight / 2) - cy;
      return Math.atan2(dy, dx) * 180 / Math.PI + 90;
    };
    startAngle = angleTo(first);
    endAngle = angleTo(last);
    if (endAngle < startAngle) [startAngle, endAngle] = [endAngle, startAngle];
    // Arc radius: 1/4 of distance from parent to first child
    const dist = Math.sqrt(Math.pow((middle.x + rectWidth / 2) - cx, 2) + Math.pow((middle.y + rectHeight / 2 - rectHeight / 2) - cy, 2));
    r = dist / 3 || 40;
  } else {
    cx = parent.x + rectWidth / 2 + rectWidth / 2;
    cy = parent.y + rectHeight / 2;
    angleTo = (child) => {
      const dx = (child.x + rectWidth / 2 - rectWidth / 2) - cx;
      const dy = (child.y + rectHeight / 2) - cy;
      return Math.atan2(dy, dx) * 180 / Math.PI + 90;
    };
    startAngle = angleTo(first);
    endAngle = angleTo(last);
    if (endAngle < startAngle) [startAngle, endAngle] = [endAngle, startAngle];
    // Arc radius: 1/4 of distance from parent to first child
    const dist = Math.sqrt(Math.pow((middle.x + rectWidth / 2 - rectWidth / 2) - cx, 2) + Math.pow((middle.y + rectHeight / 2) - cy, 2));
    r = dist / 3 || 40;
  }
  return { cx, cy, r, startAngle, endAngle };
}

// Helper to find FeatureNode by path
function getFeatureNodeByPath(root, path) {
  const parts = path.split('/').slice(1); // skip 'root'
  let node = root;
  for (const part of parts) {
    if (!node.children) return null;
    node = node.children.find(child => child.name === part);
    if (!node) return null;
  }
  return node;
}

// Helper to find parent FeatureNode by path
function getParentFeatureNodeByPath(root, path) {
  const parts = path.split('/').slice(1, -1); // skip 'root', exclude last
  let node = root;
  for (const part of parts) {
    if (!node.children) return null;
    node = node.children.find(child => child.name === part);
    if (!node) return null;
  }
  return node;
} 