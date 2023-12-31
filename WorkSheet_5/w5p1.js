"use strict"; 
window.onload = function () { main(); }
async function main()
{
    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("webgpu-canvas");
    const context = canvas.getContext("gpupresent") || canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    const pixelSize = 1/canvas.height;

    // Triangle
    const triangleVertices = [
        -0.2, 0.1, 0.9, 1,
        0.2, 0.1, 0.9, 1,
        -0.2, 0.1, -0.1, 1
    ];
    const typedTriangle = new Float32Array(triangleVertices);
    
    const vBuffer = device.createBuffer({
        size: typedTriangle.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    device.queue.writeBuffer(vBuffer, 0, typedTriangle);
    
    const faceIndicies = [
        0, 1, 2, 0
    ];
    const typedFace = new Int32Array(faceIndicies);

    const iBuffer = device.createBuffer({
        size: typedFace.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    device.queue.writeBuffer(iBuffer, 0, typedFace);

    // Create render pipeline
    const wgsl = device.createShaderModule({
        code: document.getElementById("wgsl").text
    });
    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: wgsl,
            entryPoint: "main_vs",
        },
        fragment: {
            module: wgsl,
            entryPoint: "main_fs",
            targets: [{ format: canvasFormat }]
        },
        primitive: {
            topology: "triangle-strip",
        },
    });

    const uniformBuffer = device.createBuffer({
        size: 32, // number of bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    let jitter = new Float32Array(200); // allowing subdivs from 1 to 10
    const jitterBuffer = device.createBuffer({
        size: jitter.byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    device.queue.writeBuffer(jitterBuffer, 0, jitter);

    const texture = await load_texture(device, "../WorkSheet_3/grass.jpg");
    var groupNumber = 0;
    var bindGroups = [];
    for (var i = 0; i < 2; ++i) {
        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: texture.samplers[i] },
                { binding: 2, resource: texture.createView() },
                { binding: 3, resource: { buffer: jitterBuffer } },
                { binding: 4, resource: { buffer: vBuffer } },
                { binding: 5, resource: { buffer: iBuffer } },
            ],
        });
        bindGroups.push(bindGroup);
    }
    
    async function load_texture(device, filename)
    {   
        // Load from GPU using img
        const img = document.createElement("img");
        img.src = filename;
        await img.decode();
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = img.width;
        imageCanvas.height = img.height;
        const imageCanvasContext = imageCanvas.getContext('2d');
        imageCanvasContext.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
        const imageData = imageCanvasContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height);

        // Copy data to Uint8Array
        let textureData = new Uint8Array(img.width*img.height*4);
        for(let i = 0; i < img.height; ++i)
            for(let j = 0; j < img.width; ++j)
                for(let k = 0; k < 4; ++k)
                    textureData[(i*img.width + j)*4 + k] = imageData.data[((img.height - i - 1)*img.width + j)*4 + k];

        // Stream the image data to GPU
        const texture = device.createTexture({
            size: [img.width, img.height, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
        });
        device.queue.writeTexture({ texture: texture }, textureData,
        { offset: 0, bytesPerRow: img.width*4, rowsPerImage: img.height, }, [img.width, img.height, 1]);
        
        // Create sampler
        texture.samplers = [];
        
        texture.samplers.push(device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            minFilter: "nearest",
            magFilter: "nearest",
        }));
        texture.samplers.push(device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            minFilter: "linear",
            magFilter: "linear",
        }));
        return texture;
    }
    
    canvas.addEventListener("wheel", function(ev) {
        ev.preventDefault();
        let zoom = ev.deltaY > 0 ? 0.95 : 1.05;
        uniforms[1] *= zoom; 
        animate();
    });

    var sphereMenu = document.getElementById("sphereMenu");
    sphereMenu.addEventListener("change", function(ev) {
        uniforms[2] = sphereMenu.value;
        animate();
    });
    
    var otherMenu = document.getElementById("otherMenu");
    otherMenu.addEventListener("change", function(ev) {
        uniforms[3] = otherMenu.value;
        animate();
    });

    var incrementSubdivs = document.getElementById("Increment Subdivs")
    incrementSubdivs.addEventListener("click", function(ev) {
        let temp = uniforms[4];
        if (uniforms[4] < 10) { uniforms[4]++; }
        animate();
    });

    var decrementSubdivs = document.getElementById("Decrement Subdivs")
    decrementSubdivs.addEventListener("click", function(ev) {
        let temp = uniforms[4];
        if (uniforms[4] > 1) { uniforms[4]--; }
        animate();
    });
    
    var filterMenu = document.getElementById("filterMenu");
    filterMenu.addEventListener("change", function(ev) {
        groupNumber = parseInt(filterMenu.value);
        requestAnimationFrame(animate);
    });

    var scalorgatorSlide = document.getElementById("ScaleMeDaddy");
    scalorgatorSlide.addEventListener("input", function(ev) {
        uniforms[5] = ev.currentTarget.value;
        animate();
    });

    const aspect = canvas.width/canvas.height;
    const camera_constant = 1.0;
    const sphereMat = 3;
    const otherMat = 1;
    const jitterSub = 4;
    const scalingFactor = 0.2;
    var uniforms = new Float32Array([aspect, camera_constant, sphereMat, otherMat, jitterSub, scalingFactor, 0, 0]);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    
    function render() {
        compute_jitters(jitter, pixelSize, uniforms[4]);
        device.queue.writeBuffer(jitterBuffer, 0, jitter);

        device.queue.writeBuffer(uniformBuffer, 0, uniforms);
        // Create a render pass in a command buffer and submit it
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                storeOp: "store",
            }]
        });

        // Insert render pass commands here
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroups[groupNumber]);
        pass.draw(4);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }
    
    function animate() { render(device, context, pipeline, bindGroups[groupNumber]); }
    animate();
}

function compute_jitters(jitter, pixelSize, jitterSub)
{
	const step = pixelSize/jitterSub;
	if(jitterSub < 2) 
	{
		jitter[0] = 0.0;
		jitter[1] = 0.0;
	}
	else 
	{
		for (var i = 0; i < jitterSub; ++i) 
		{
			for (var j = 0; j < jitterSub; ++j) 
			{
			const idx = (i*jitterSub + j)*2;
			jitter[idx] = (Math.random() + j)*step - pixelSize*0.5;
			jitter[idx + 1] = (Math.random() + i)*step - pixelSize*0.5;
			}
		}
	}
}