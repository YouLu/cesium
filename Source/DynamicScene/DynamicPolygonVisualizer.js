/*global define*/
define([
        '../Core/Cartesian3',
        '../Core/Color',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/DeveloperError',
        '../Core/destroyObject',
        '../Core/GeometryInstance',
        '../Core/PolygonGeometry',
        '../Core/ColorGeometryInstanceAttribute',
        '../Core/ShowGeometryInstanceAttribute',
        './ConstantProperty',
        './ColorMaterialProperty',
        './DynamicObjectCollection',
        '../Scene/Primitive',
        '../Scene/PerInstanceColorAppearance',
        '../Scene/Polygon',
        '../Scene/Material',
        './MaterialProperty'
       ], function(
         Cartesian3,
         Color,
         defaultValue,
         defined,
         DeveloperError,
         destroyObject,
         GeometryInstance,
         PolygonGeometry,
         ColorGeometryInstanceAttribute,
         ShowGeometryInstanceAttribute,
         ConstantProperty,
         ColorMaterialProperty,
         DynamicObjectCollection,
         Primitive,
         PerInstanceColorAppearance,
         Polygon,
         Material,
         MaterialProperty) {
    "use strict";

    var emptyArray = [];
    var cachedPosition = new Cartesian3();
    var scratchColor = new Color();

    var DynamicObjectPolygonGeometryMap = function() {
        this._array = [];
        this._hash = {};
    };

    DynamicObjectPolygonGeometryMap.prototype.getArray = function() {
        return this._array;
    };

    DynamicObjectPolygonGeometryMap.prototype.getById = function(id) {
        return this._hash[id];
    };

    DynamicObjectPolygonGeometryMap.prototype.add = function(value) {
        this._hash[value.id.id] = value;
        this._array.push(value);
    };

    DynamicObjectPolygonGeometryMap.prototype.removeById = function(id) {
        var hasValue = defined(this._hash[id]);
        if (hasValue) {
            var array = this._array;
            array.splice(array.indexOf(this._hash[id]), 1);
            this._hash[id] = undefined;
        }
        return hasValue;
    };

    DynamicObjectPolygonGeometryMap.prototype.removeAll = function() {
        this._hash = {};
        this._array.length = 0;
    };

    var PerInstaceColorBatch = function(scene, translucent) {
        if (!defined(scene)) {
            throw new DeveloperError('scene is required.');
        }

        this._scene = scene;
        this._primitives = scene.getPrimitives();

        this._colorGeometries = new DynamicObjectPolygonGeometryMap();
        this._colorPrimitive = undefined;
        this._createColorPrimitive = false;
        this._translucent = translucent;
    };

    PerInstaceColorBatch.prototype.matches = function(time, dynamicObject) {
        var vertexPositions = dynamicObject.vertexPositions;
        if (!(vertexPositions instanceof ConstantProperty)) {
            return false;
        }
        var polygon = dynamicObject.polygon;

        if (!defined(polygon)) {
            return false;
        }

        var material = polygon.material;
        if (!defined(material)) {
            return !this._translucent;
        }

        if (!(polygon.material instanceof ColorMaterialProperty)) {
            return false;
        }

        var color = polygon.material.color;
        if (!defined(color.getValue(time, scratchColor))) {
            return true;
        }

        if (this._translucent) {
            return scratchColor.alpha < 1.0;
        }
        return scratchColor.alpha === 1.0;
    };

    PerInstaceColorBatch.prototype.add = function(time, dynamicObject) {
        var polygon = dynamicObject.polygon;
        var material = polygon.material;

        var showProperty = polygon.show;
        var show = dynamicObject.isAvailable(time) && (defined(showProperty) ? showProperty.getValue(time) : true);

        var positions = dynamicObject.vertexPositions.getValue(time);

        var colorProperty = material.color;
        var color = defined(colorProperty) ? colorProperty.getValue(time) : Color.WHITE;

        var heightProperty = polygon.height;
        var height = defined(heightProperty) ? heightProperty.getValue(time) : undefined;

        var extrudedHeightProperty = polygon.extrudedHeight;
        var extrudedHeight = defined(heightProperty) ? extrudedHeightProperty.getValue(time) : undefined;

        var instance = new GeometryInstance({
            id : dynamicObject,
            geometry : PolygonGeometry.fromPositions({
                positions : positions,
                vertexFormat : PerInstanceColorAppearance.VERTEX_FORMAT,
                height : height,
                extrudedHeight : extrudedHeight
            }),
            attributes : {
                show : new ShowGeometryInstanceAttribute(show),
                color : ColorGeometryInstanceAttribute.fromColor(color)
            }
        });

        instance.dynamicColor = defined(colorProperty) && !(colorProperty instanceof ConstantProperty);
        instance.color = colorProperty;
        instance.dynamicShow = (defined(showProperty) && !(showProperty instanceof ConstantProperty)) || defined(dynamicObject.availability);
        instance.show = showProperty;
        instance.dynamicObject = dynamicObject;

        this._colorGeometries.add(instance);
        this._createColorPrimitive = true;
    };

    PerInstaceColorBatch.prototype.remove = function(dynamicObject) {
        this._createColorPrimitive = this._colorGeometries.removeById(dynamicObject.id) || this._createColorPrimitive;
    };

    PerInstaceColorBatch.prototype.update = function(time) {
        var i;
        var show;
        var instance;
        var color;

        var colorPrimitive = this._colorPrimitive;
        var primitives = this._primitives;
        if (this._createColorPrimitive) {
            if (defined(colorPrimitive)) {
                primitives.remove(colorPrimitive);
            }
            colorPrimitive = new Primitive({
                asynchronous : false,
                geometryInstances : this._colorGeometries.getArray(),
                appearance : new PerInstanceColorAppearance({
                    translucent : this._translucent
                })
            });

            primitives.add(colorPrimitive);
            this._colorPrimitive = colorPrimitive;
            this._createColorPrimitive = false;
        } else {
            var geometries = this._colorGeometries.getArray();
            for (i = geometries.length - 1; i > -1; i--) {
                instance = geometries[i];
                var attributes = instance.dynamicAttributes;
                if (!defined(attributes)) {
                    attributes = colorPrimitive.getGeometryInstanceAttributes(instance.id);
                    instance.dynamicAttributes = attributes;
                }
                if (instance.dynamicColor) {
                    color = instance.color.getValue(time);
                    if (defined(color)) {
                        attributes.color = ColorGeometryInstanceAttribute.toValue(color, attributes.color);
                    }
                }
                if (instance.dynamicShow) {
                    show = instance.dynamicObject.isAvailable(time) && (!defined(instance.show) || instance.show.getValue(time));
                    if (defined(show)) {
                        attributes.show = ShowGeometryInstanceAttribute.toValue(show, attributes.show);
                    }
                }
            }
        }
    };

    PerInstaceColorBatch.prototype.removeAllPrimitives = function() {
        if (defined(this._colorPrimitive)) {
            var primitives = this._primitives;
            primitives.remove(this._colorPrimitive);
            this._colorPrimitive = undefined;
            this._colorGeometries.removeAll();
        }
    };

    var DynamicBatch = function(scene) {
        this._scene = scene;
        this._primitives = scene.getPrimitives();
        this._polygons = new DynamicObjectPolygonGeometryMap();
        this._unusedPolygons = [];
        this._dynamicObjects = new DynamicObjectCollection();
    };

    DynamicBatch.prototype.matches = function(time, dynamicObject) {
        return true;
    };

    DynamicBatch.prototype.add = function(time, dynamicObject) {
        this._dynamicObjects.add(dynamicObject);
    };

    DynamicBatch.prototype.remove = function(dynamicObject) {
        var polygon = this._polygons.getById(dynamicObject.id);
        if (defined(polygon)) {
            polygon.show = false;
            this._unusedPolygons.push(polygon);
            this._polygons.removeById(dynamicObject.id);
            this._dynamicObjects.removeById(dynamicObject.id);
        }
    };

    DynamicBatch.prototype.update = function(time) {
        var dynamicObjects = this._dynamicObjects.getObjects();

        for ( var i = 0, len = dynamicObjects.length; i < len; i++) {
            var dynamicObject = dynamicObjects[i];
            var dynamicPolygon = dynamicObject._polygon;

            var polygon = this._polygons.getById(dynamicObject.id);
            var showProperty = dynamicPolygon._show;
            var ellipseProperty = dynamicObject._ellipse;
            var positionProperty = dynamicObject._position;
            var vertexPositionsProperty = dynamicObject._vertexPositions;
            var show = dynamicObject.isAvailable(time) && (!defined(showProperty) || showProperty.getValue(time));
            var hasVertexPostions = defined(vertexPositionsProperty);

            if (!show || (!hasVertexPostions && (!defined(ellipseProperty) || !defined(positionProperty)))) {
                //Remove the existing primitive if we have one
                if (defined(polygon)) {
                    polygon.show = false;
                    this._unusedPolygons.push(polygon);
                }
                continue;
            }

            if (!defined(polygon)) {
                polygon = this._unusedPolygons.pop();
                if (!defined(polygon)) {
                    polygon = new Polygon();
                    polygon.asynchronous = false;
                    this._primitives.add(polygon);
                }
                polygon.id = dynamicObject;
                polygon.material = Material.fromType(Material.ColorType);
                this._polygons.add(polygon);
            }

            polygon.show = true;

            var vertexPositions;
            if (hasVertexPostions) {
                vertexPositions = vertexPositionsProperty.getValue(time);
            } else {
                vertexPositions = ellipseProperty.getValue(time, positionProperty.getValue(time, cachedPosition));
            }

            if (polygon._visualizerPositions !== vertexPositions && //
            defined(vertexPositions) && //
            vertexPositions.length > 3) {
                polygon.setPositions(vertexPositions);
                polygon._visualizerPositions = vertexPositions;
            }

            polygon.material = MaterialProperty.getValue(time, dynamicPolygon._material, polygon.material);
        }
    };

    DynamicBatch.prototype.removeAllPrimitives = function() {
        var i;
        var primitives = this._primitives;
        var polygons = this._polygons.getArray();
        var length = polygons.length;
        for (i = 0; i < length; i++) {
            primitives.remove(polygons[i]);
        }

        polygons = this._unusedPolygons;
        length = polygons.length;
        for (i = 0; i < length; i++) {
            primitives.remove(polygons[i]);
        }

        this._polygons.removeAll();
        this._unusedPolygons.length = 0;
        this._dynamicObjects.removeAll();
    };

    /**
     * A DynamicObject visualizer which maps the DynamicPolygon instance
     * in DynamicObject.polygon to a Polygon primitive.
     * @alias DynamicPolygonVisualizer
     * @constructor
     *
     * @param {Scene} scene The scene the primitives will be rendered in.
     * @param {DynamicObjectCollection} [dynamicObjectCollection] The dynamicObjectCollection to visualize.
     *
     * @exception {DeveloperError} scene is required.
     *
     * @see DynamicPolygon
     * @see Scene
     * @see DynamicObject
     * @see DynamicObjectCollection
     * @see CompositeDynamicObjectCollection
     * @see VisualizerCollection
     * @see DynamicBillboardVisualizer
     * @see DynamicConeVisualizer
     * @see DynamicConeVisualizerUsingCustomSensorr
     * @see DynamicLabelVisualizer
     * @see DynamicPointVisualizer
     * @see DynamicPolylineVisualizer
     * @see DynamicPyramidVisualizer
     */
    var DynamicPolygonVisualizer = function(scene, dynamicObjectCollection) {
        if (!defined(scene)) {
            throw new DeveloperError('scene is required.');
        }

        this._scene = scene;
        this._primitives = scene.getPrimitives();
        this._dynamicObjectCollection = undefined;
        this._addedObjects = new DynamicObjectCollection();
        this._removedObjects = new DynamicObjectCollection();
        this._batches = [new PerInstaceColorBatch(scene, true), new PerInstaceColorBatch(scene, false), new DynamicBatch(scene)];
        this.setDynamicObjectCollection(dynamicObjectCollection);
    };

    /**
     * Returns the scene being used by this visualizer.
     *
     * @returns {Scene} The scene being used by this visualizer.
     */
    DynamicPolygonVisualizer.prototype.getScene = function() {
        return this._scene;
    };

    /**
     * Gets the DynamicObjectCollection being visualized.
     *
     * @returns {DynamicObjectCollection} The DynamicObjectCollection being visualized.
     */
    DynamicPolygonVisualizer.prototype.getDynamicObjectCollection = function() {
        return this._dynamicObjectCollection;
    };

    /**
     * Sets the DynamicObjectCollection to visualize.
     *
     * @param dynamicObjectCollection The DynamicObjectCollection to visualizer.
     */
    DynamicPolygonVisualizer.prototype.setDynamicObjectCollection = function(dynamicObjectCollection) {
        var oldCollection = this._dynamicObjectCollection;
        if (oldCollection !== dynamicObjectCollection) {
            if (defined(oldCollection)) {
                oldCollection.collectionChanged.removeEventListener(DynamicPolygonVisualizer.prototype.onCollectionChanged, this);
                this.removeAllPrimitives();
            }
            this._dynamicObjectCollection = dynamicObjectCollection;
            if (defined(dynamicObjectCollection)) {
                dynamicObjectCollection.collectionChanged.addEventListener(DynamicPolygonVisualizer.prototype.onCollectionChanged, this);
                this.onCollectionChanged(dynamicObjectCollection, dynamicObjectCollection.getObjects(), emptyArray);
            }
        }
    };

    /**
     * Updates all of the primitives created by this visualizer to match their
     * DynamicObject counterpart at the given time.
     *
     * @param {JulianDate} time The time to update to.
     *
     * @exception {DeveloperError} time is required.
     */
    DynamicPolygonVisualizer.prototype.update = function(time) {
        if (!defined(time)) {
            throw new DeveloperError('time is requied.');
        }

        var polygon;

        var addedObjects = this._addedObjects;
        var added = addedObjects.getObjects();
        var removedObjects = this._removedObjects;
        var removed = removedObjects.getObjects();
        var batches = this._batches;
        var batchesLength = batches.length;

        var i;
        var g;
        var dynamicObject;
        for (i = removed.length - 1; i > -1; i--) {
            dynamicObject = removed[i];

            for (g = 0; g < batchesLength; g++) {
                batches[g].remove(dynamicObject);
            }

            dynamicObject.propertyChanged.removeEventListener(DynamicPolygonVisualizer._onPropertyChanged, this);
            polygon = dynamicObject.polygon;
            if (defined(polygon)) {
                polygon.propertyChanged.removeEventListener(DynamicPolygonVisualizer._onPolygonPropertyChanged, this);
            }
        }

        for (i = added.length - 1; i > -1; i--) {
            dynamicObject = added[i];

            dynamicObject.propertyChanged.addEventListener(DynamicPolygonVisualizer._onPropertyChanged, this);

            var vertexPositions = dynamicObject.vertexPositions;
            polygon = dynamicObject.polygon;

            if (defined(polygon)) {
                polygon.propertyChanged.addEventListener(DynamicPolygonVisualizer._onPolygonPropertyChanged, this);

                for (g = 0; g < batchesLength; g++) {
                    var batch = batches[g];
                    if (batch.matches(time, dynamicObject)) {
                        batch.add(time, dynamicObject);
                        continue;
                    }
                }
            }
        }

        addedObjects.removeAll();
        removedObjects.removeAll();

        for (g = 0; g < batchesLength; g++) {
            batches[g].update(time);
        }
    };

    /**
     * Removes all primitives from the scene.
     */
    DynamicPolygonVisualizer.prototype.removeAllPrimitives = function() {
        var removed = this._removedObjects.getObjects();
        var dynamicObject;
        for (var i = removed.length - 1; i > -1; i--) {
            dynamicObject = removed[i];
            dynamicObject.propertyChanged.removeEventListener(DynamicPolygonVisualizer._onPropertyChanged, this);
            var polygon = dynamicObject.polygon;
            if (defined(polygon)) {
                polygon.propertyChanged.removeEventListener(DynamicPolygonVisualizer._onPolygonPropertyChanged, this);
            }
        }

        this._addedObjects.removeAll();
        this._removedObjects.removeAll();

        var batches = this._batches;
        var batchesLength = batches.length;
        for (var g = 0; g < batchesLength; g++) {
            batches[g].removeAllPrimitives();
        }
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof DynamicPolygonVisualizer
     *
     * @returns {Boolean} True if this object was destroyed; otherwise, false.
     *
     * @see DynamicPolygonVisualizer#destroy
     */
    DynamicPolygonVisualizer.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof DynamicPolygonVisualizer
     *
     * @returns {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see DynamicPolygonVisualizer#isDestroyed
     *
     * @example
     * visualizer = visualizer && visualizer.destroy();
     */
    DynamicPolygonVisualizer.prototype.destroy = function() {
        this.removeAllPrimitives();
        return destroyObject(this);
    };

    DynamicPolygonVisualizer._onPropertyChanged = function(dyamicObject, name, value, oldValue) {
    };

    DynamicPolygonVisualizer._onPolygonPropertyChanged = function(polygon, name, value, oldValue) {
    };

    DynamicPolygonVisualizer.prototype.onCollectionChanged = function(dynamicObjectCollection, added, removed) {
        var addedObjects = this._addedObjects;
        var removedObjects = this._removedObjects;

        var i;
        var dynamicObject;
        for (i = removed.length - 1; i > -1; i--) {
            dynamicObject = removed[i];
            addedObjects.remove(dynamicObject);
            removedObjects.add(dynamicObject);
        }

        for (i = added.length - 1; i > -1; i--) {
            dynamicObject = added[i];
            addedObjects.add(dynamicObject);
            removedObjects.remove(dynamicObject);
        }
    };

    return DynamicPolygonVisualizer;
});
