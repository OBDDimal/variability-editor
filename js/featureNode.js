export class FeatureNode {
  constructor(name, { children = [], groupType = 'and', mandatory = false, abstract = false, type = undefined, collapsed = false, attr = [] } = {}) {
    this.name = name;
    this.children = children;
    this.groupType = groupType;
    this.mandatory = mandatory;
    this.abstract = abstract;
    this.type = type;
    this.collapsed = collapsed;
    this.attr = attr;
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
      attr: this.attr
    };
  }
} 