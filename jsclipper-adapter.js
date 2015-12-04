var ClipperLib = require ('./jsclipper')

// == CONVERSION HELPERS FROM Array TO ClipperLib

function arrayToObjectNotation(arrayOfPoints) {
  return arrayOfPoints.map(function(point) {
    return {X: point[0], Y: point[1]}
  })
}

function objectToArrayNotation(arrayOfPoints) {
  return arrayOfPoints.map(function(point) {
    return [point.X, point.Y]
  })
}

function arrayToClipperPaths(arrayOfPaths) {
  return arrayOfPaths.map(arrayToObjectNotation)
}

function clipperPathsToArray(arrayOfPaths) {
  return arrayOfPaths.map(objectToArrayNotation)
}

// == TYPES FOR CUSTOM APPLICATION OF clip ==

var FillType = {
  EVEN_ODD: ClipperLib.PolyFillType.pftEvenOdd,
  NON_ZERO: ClipperLib.PolyFillType.pftNonZero,
  NEGATIVE: ClipperLib.PolyFillType.pftNegative,
  POSITIVE: ClipperLib.PolyFillType.pftPositive
}

var ClipType = {
  INTERSECTION: ClipperLib.ClipType.ctIntersection,
  UNION: ClipperLib.ClipType.ctUnion,
  DIFFERENCE: ClipperLib.ClipType.ctDifference,
  XOR: ClipperLib.ClipType.ctXor
}

// == GENERAL PURPOSE CLIPPING ==

function clip(subj, clips, clipType, scale, fillType) {
  var scale = scale || Math.pow(10, 6)
  var fillType = fillType || FillType.NON_ZERO

  if (!Array.isArray(subj)) {
    throw new Error('Provide subject polygon as an array of paths.')
  }

  if (!Array.isArray(clips)) {
    throw new Error('Provide clip polygons as arrays of paths.')
  }

  if (clips.length == 0) {
    throw new Error('Provide at least one clip.')
  }

  if ('number' != typeof clipType || !(0 <= clipType && clipType < 4)) {
    throw new Error('Provide a valid clip type!')
  }

  var subjPaths = arrayToClipperPaths(subj)
  var clipsPaths = clips.map(arrayToClipperPaths)

  var clipper = new ClipperLib.Clipper()
  ClipperLib.JS.ScaleUpPaths(subjPaths, scale)
  clipper.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true)
  clipsPaths.forEach(function(clipPaths) {
    ClipperLib.JS.ScaleUpPaths(clipPaths, scale)
    clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true)
  })

  var solution = []
  var succeeded = clipper.Execute(clipType, solution, fillType, fillType)

  if (succeeded) {
    ClipperLib.JS.ScaleDownPaths(solution, scale)
    return clipperPathsToArray(solution)
  }

  // return false when the clipping failed
  return false
}

// == CLIPPING METHODS ==

function intersect(subj, clips) {
  return clip(subj, clips, ClipType.INTERSECTION)
}

function union(subj, clips) {
  return clip(subj, clips, ClipType.UNION)
}

function diff(subj, clips) {
  return clip(subj, clips, ClipType.DIFFERENCE)
}

function xor(subj, clips) {
  return clip(subj, clips, ClipType.XOR)
}

// == POLYGON METHODS ==

function Polygon(shape, holes) {
  if (!Array.isArray(shape)) {
    throw new Error('Given shape should be an array of points [x,y].')
  }

  holes = holes || []
  if (!Array.isArray(holes)) {
    throw new Error('Given holes should be an array of paths.')
  }

  // force intented orientation on polygons
  var _shape = shape.concat()
  var _holes = holes.concat()
  if (!Polygon.isCounterClockwise(shape)) {
    _shape.reverse()
  }

  _holes = _holes.map(function(hole) {
    if (Polygon.isCounterClockwise(hole)) {
      return hole.concat().reverse()
    }
    return hole
  })

  this._paths = [_shape].concat(_holes)
}

Polygon.prototype.getPaths = function() {
  return this._paths.slice()
}

Polygon.prototype.getShape = function() {
  return this._paths.slice(0,1)
}

Polygon.prototype.getHoles = function() {
  return this._paths.slice(1)
}

/** use clip method on subject polygon with multiple clip polygons **/

Polygon.prototype.clipMultiple = function(clipPolygons, clipType) {
  var clipPaths = clipPolygons.map(function(polygon) {
    return polygon.getPaths()
  })
  var solution = clip(this.getPaths(), clipPaths, clipType)

  if (solution) {
    return Polygon.assignShapesAndHoles(solution)
  }

  // return false when clipping failed
  return false
}

Polygon.prototype.diffMultiple = function (clipPolygons) {
  return this.clipMultiple(clipPolygons, ClipType.DIFFERENCE)
}

Polygon.prototype.intersectMultiple = function (clipPolygons) {
  return this.clipMultiple(clipPolygons, ClipType.INTERSECTION)
}

Polygon.prototype.unionMultiple = function (clipPolygons) {
  return this.clipMultiple(clipPolygons, ClipType.UNION)
}

Polygon.prototype.xorMultiple = function (clipPolygons) {
  return this.clipMultiple(clipPolygons, ClipType.XOR)
}

/** use clip method on subject polygon with a single clip polygon **/

Polygon.prototype.diff = function (clipPolygons) {
  return this.clipMultiple([clipPolygons], ClipType.DIFFERENCE)
}

Polygon.prototype.intersect = function (clipPolygons) {
  return this.clipMultiple([clipPolygons], ClipType.INTERSECTION)
}

Polygon.prototype.union = function (clipPolygons) {
  return this.clipMultiple([clipPolygons], ClipType.UNION)
}

Polygon.prototype.xor = function (clipPolygons) {
  return this.clipMultiple([clipPolygons], ClipType.XOR)
}

Polygon.assignShapesAndHoles = function(paths) {
  function separateHolesFromShapes(paths) {
    var holes = []
    var shapes = []

    paths.forEach(function(path) {
      // by JSClipper convention shape boundaries are CCW
      if (Polygon.isCounterClockwise(path)) {
        shapes.push(path)
      } else {
        holes.push(path)
      }
    })

    return {
      shapes: shapes,
      holes: holes
    }
  }

  function groupHolesForShape(holes) {
    return function(shape) {
      var _holes = holes.filter(function(hole) {
        return Polygon.contains(shape, hole)
      })

      return new Polygon(shape, _holes)
    }
  }

  var p = separateHolesFromShapes(paths)
  return p.shapes.map(groupHolesForShape(p.holes))
}

/**
 * Outputs true if the polygon has a CCW winding
 * @return {Boolean}
 */
Polygon.isCounterClockwise = function(path) {
  // calculate signed polygon area
  // if positive area --> counter clockwise winding
  return ClipperLib.Clipper.Orientation(arrayToObjectNotation(path))
};

Polygon.contains = function(outer, inner) {
  var _outer = arrayToObjectNotation(outer)
  var _inner = arrayToObjectNotation(inner)
  return _inner.reduce(function(acc, point) {
    return acc && 0 !== ClipperLib.Clipper.PointInPolygon(point, _outer)
  }, true)
}

// == EXPORTS ==
module.exports = {
  arrayToObjectNotation: arrayToObjectNotation,
  objectToArrayNotation: objectToArrayNotation,
  arrayToClipperPaths: arrayToClipperPaths,
  clipperPathsToArray: clipperPathsToArray,

  FillType: FillType,
  ClipType: ClipType,

  clip: clip,
  intersect: intersect,
  union: union,
  diff: diff,
  xor: xor,

  Polygon: Polygon,

  ClipperLib: ClipperLib
}
