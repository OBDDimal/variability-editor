export class FeatureNode {
  constructor(name, { children = [], groupType = 'and', mandatory = false, abstract = false, type = undefined, collapsed = false, attr = [], isIndicator = false, indicatorType = undefined, groupIdx = undefined, count = undefined, parentPath = undefined, hiddenIndices = undefined } = {}) {
    this.name = name;
    this.children = children;
    this.groupType = groupType;
    this.mandatory = mandatory;
    this.abstract = abstract;
    this.type = type;
    this.collapsed = collapsed;
    this.attr = attr;
    this.isIndicator = isIndicator;
    this.indicatorType = indicatorType;
    this.groupIdx = groupIdx;
    this.count = count;
    this.parentPath = parentPath;
    this.hiddenIndices = hiddenIndices;
  }

  toObject() {
    return {
      name: this.name,
      children: this.children.map(child => child.toObject()),
      groupType: this.groupType,
      mandatory: this.mandatory,
      abstract: this.abstract,
      type: this.type,
      collapsed: this.collapsed,
      attr: this.attr,
      isIndicator: this.isIndicator,
      indicatorType: this.indicatorType,
      groupIdx: this.groupIdx,
      count: this.count,
      parentPath: this.parentPath,
      hiddenIndices: this.hiddenIndices
    };
  }
} 