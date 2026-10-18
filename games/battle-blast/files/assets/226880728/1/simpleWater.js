var SimpleWater = pc.createScript('simpleWater');

SimpleWater.attributes.add('materialAsset', { type: 'asset', assetType: 'material'});
SimpleWater.attributes.add('noiseTexture', { type: 'asset', assetType: 'texture'});
SimpleWater.attributes.add('subdivisions', {type:'number', title:"Subdivisions", default: 100});
SimpleWater.attributes.add("waveVertexLength", {
  type: "number",
  default: 1.0,
  min: 0.0,
});
SimpleWater.attributes.add("waveVertexAmplitude", {
  type: "number",
  default: 1.0,
  min: 0.0,
});
SimpleWater.attributes.add('waterTextureIntensity', {type:'number', title:"Water Texture Intensity", default: 0.75});
SimpleWater.attributes.add('waterTextureSpeed', {type: 'vec2'});

SimpleWater.tmpVec2 = new pc.Vec2();
SimpleWater.tmpOffset = new pc.Vec2();

// initialize code called once per entity
SimpleWater.prototype.initialize = function() {
    this.timer = 0;
    this.prepareMaterial();
    this.generateWaterMesh();
    this.on('attr', this.updateAttributes);
};

SimpleWater.prototype.prepareMaterial = function() {
    this.material = this.materialAsset ? this.materialAsset.resource : null;
    if (!this.material) return;

    this.material.chunks.transformVS = SimpleWater.transformVS;
    this.material.update();

    this.updateAttributes();
};

SimpleWater.prototype.updateAttributes = function(property) {
    if (property === 'materialAsset') this.prepareMaterial();
    if (!this.material) return;

    if (this.noiseTexture) this.material.setParameter("waveNoiseTexture", this.noiseTexture.resource);
    this.material.setParameter("waveVertexLength", this.waveVertexLength);
    this.material.setParameter("waveVertexAmplitude", this.waveVertexAmplitude);
    this.material.setParameter('waterTextureIntensity', this.waterTextureIntensity);
};

SimpleWater.prototype.generateWaterMesh = function() {
    if (!this.material) return;

    const modelComponent = this.entity.model ? this.entity.model : this.entity.render;
    if (!modelComponent) return;

    const aabb = modelComponent.meshInstances[0].aabb;
    const width = aabb.halfExtents.x * 2 * 0.01;
    const height = aabb.halfExtents.z * 2 * 0.01;
    const options = {subdivisions: this.subdivisions, width, height};

    var positions = [];
    var uvs = [];
    var indices = [];

    for (let row = 0; row <= options.subdivisions; row++) {
        for (let col = 0; col <= options.subdivisions; col++) {
            var position = new pc.Vec3(
                (col * options.width) / options.subdivisions - (options.width / 2.0),
                0,
                ((options.subdivisions - row) * options.height) / options.subdivisions - (options.height / 2.0)
            );
            positions.push(position.x, position.y, position.z);
            uvs.push(col / options.subdivisions, 1.0 - row / options.subdivisions);
        }
    }

    for (let row = 0; row < options.subdivisions; row++) {
        for (let col = 0; col < options.subdivisions; col++) {
            indices.push(col + row * (options.subdivisions + 1));
            indices.push(col + 1 + row * (options.subdivisions + 1));
            indices.push(col + 1 + (row + 1) * (options.subdivisions + 1));

            indices.push(col + row * (options.subdivisions + 1));
            indices.push(col + 1 + (row + 1) * (options.subdivisions + 1));
            indices.push(col + (row + 1) * (options.subdivisions + 1));
        }
    }

    const normals = pc.calculateNormals(positions, indices);
    const mesh = pc.createMesh(this.app.graphicsDevice, positions, {
        normals: normals,
        uvs: uvs,
        indices: indices
    });

    const meshInstance = new pc.MeshInstance(mesh, this.material);
    modelComponent.meshInstances = [meshInstance];
};

SimpleWater.prototype.update = function(dt) {
    if (!this.material) return;

    this.timer += dt;
    this.material.setParameter("waterWavesTime", this.timer);
    this.scrollWaterTexture(dt);
};

SimpleWater.prototype.scrollWaterTexture = function(dt) {
    var velocity = SimpleWater.tmpVec2;
    var offset = SimpleWater.tmpOffset;

    velocity.set(this.waterTextureSpeed.x, this.waterTextureSpeed.y);
    velocity.scale(dt);

    offset.copy(this.material.diffuseMapOffset);
    offset.add(velocity);

    this.material.diffuseMapOffset = offset;
    this.material.normalMapOffset = offset;
    this.material.update();
};

SimpleWater.prototype.swap = function() {
    this.initialize();
};

SimpleWater.transformVS = `
uniform float waterWavesTime;
uniform float waveVertexLength;
uniform float waveVertexAmplitude;

mat4 getModelMatrixNew() {
    #ifdef DYNAMICBATCH
    return getBoneMatrix(vertex_boneIndices);
    #elif defined(SKIN)
    return matrix_model * getSkinMatrix(vertex_boneIndices, vertex_boneWeights);
    #elif defined(INSTANCING)
    return mat4(instance_line1, instance_line2, instance_line3, instance_line4);
    #else
    return matrix_model;
    #endif
}

vec4 getPosition() {
    mat4 m = getModelMatrixNew();
    vec3 localPos = vertex_position.xyz;

    vec4 posW = m * vec4(localPos, 1.0);
    posW.y += 
        cos(posW.z * waveVertexLength + waterWavesTime) *
        waveVertexAmplitude *
        sin(posW.x * waveVertexLength + waterWavesTime);

    dPositionW = posW.xyz;
    return matrix_viewProjection * posW;
}

vec3 getWorldPosition() {
    return dPositionW;
}
`;
;
