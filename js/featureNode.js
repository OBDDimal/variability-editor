export class FeatureNode {
  constructor(name, { children = [], groupType = 'and', abstract = false, type = undefined, attr = [] } = {}) {
    this.name = name;
    this.children = children;
    this.groupType = groupType;
    this.abstract = abstract;
    this.type = type;
    this.attr = attr;
  }

  toObject() {
    return {
      name: this.name,
      children: this.children.map(child => child.toObject()),
      groupType: this.groupType,
      abstract: this.abstract,
      type: this.type,
      attr: this.attr
    };
  }
} 