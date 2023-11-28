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

    var obj_filename = '../objects/CornellBoxWithBlocks.obj';
    var g_objDoc = null; // Info parsed from OBJ file
    var g_drawingInfo = null; // Info for drawing the 3D model with WebGL

    readOBJFile(obj_filename, 1, true); // file name, scale, ccw vertices

    // Read a file
    function readOBJFile(fileName, scale, reverse)
    {
        var request = new XMLHttpRequest();
        request.onreadystatechange = function() {
            if (request.readyState === 4 && request.status !== 404) 
            {
                onReadOBJFile(request.responseText, fileName, scale, reverse);
            }
        }
        request.open('GET', fileName, true); // Create a request to get file
        request.send(); // Send the request
    }

    // OBJ file has been read
    function onReadOBJFile(fileString, fileName, scale, reverse)
    {
        var objDoc = new OBJDoc(fileName); // Create a OBJDoc object
        var result = objDoc.parse(fileString, scale, reverse);
        if (!result) 
        {
            g_objDoc = null; g_drawingInfo = null;
            console.log("OBJ file parsing error.");
            return;
        }
        g_objDoc = objDoc;
    }

    let jitter = new Float32Array(200); // allowing subdivs from 1 to 10
        const jitterBuffer = device.createBuffer({
            size: jitter.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        
    device.queue.writeBuffer(jitterBuffer, 0, jitter);
    
    // Set up buffers
    const uniformBuffer = device.createBuffer({
        size: 16, // number of bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const aspect = canvas.width/canvas.height;
    const camera_constant = 1.0;
    const jitterSub = 1;
    var uniforms = new Float32Array([aspect, camera_constant, jitterSub, 0  ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    // OBJ File has been read completely
    function onReadComplete(device, pipeline)
    {
        // Get access to loaded data
        g_drawingInfo = g_objDoc.getDrawingInfo();
        

        const vBuffer = device.createBuffer({
            size: g_drawingInfo.vertices.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(vBuffer, 0, g_drawingInfo.vertices);
        
        const iBuffer = device.createBuffer({
            size: g_drawingInfo.indices.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(iBuffer, 0, g_drawingInfo.indices);
        
        const miBuffer = device.createBuffer({
            size: g_drawingInfo.mat_indices.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(miBuffer, 0, g_drawingInfo.mat_indices);
        
        const liBuffer = device.createBuffer({
            size: g_drawingInfo.light_indices.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(liBuffer, 0, g_drawingInfo.light_indices);

        
        let matColors = new Float32Array(g_drawingInfo.materials.length*4);
        
        for (var i = 0; i < g_drawingInfo.materials.length; i++) 
        {
            var idx = i*4;
            matColors[idx] = g_drawingInfo.materials[i].color.r;
            matColors[idx+1] = g_drawingInfo.materials[i].color.g;
            matColors[idx+2] = g_drawingInfo.materials[i].color.b;
            matColors[idx+3] = g_drawingInfo.materials[i].color.a;
        }
        

        const mcBuffer = device.createBuffer({
            size: matColors.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(mcBuffer, 0, matColors);

        let matEmissions = new Float32Array(g_drawingInfo.materials.length*4);
 
        for (var i = 0; i < g_drawingInfo.materials.length; i++) 
        {
            var idx = i*4;
            matEmissions[idx] = g_drawingInfo.materials[i].emission.r;
            matEmissions[idx+1] = g_drawingInfo.materials[i].emission.g;
            matEmissions[idx+2] = g_drawingInfo.materials[i].emission.b;
            matEmissions[idx+3] = g_drawingInfo.materials[i].emission.a;
        }

        const meBuffer = device.createBuffer({
            size: matEmissions.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
        });
        device.queue.writeBuffer(meBuffer, 0, matEmissions);

        // Create and return bind group
        const bindGroup = device.createBindGroup(
        {
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: jitterBuffer } },
                { binding: 2, resource: { buffer: vBuffer } },
                { binding: 3, resource: { buffer: iBuffer } },
                { binding: 5, resource: { buffer: miBuffer } },
                { binding: 6, resource: { buffer: mcBuffer } },
                { binding: 7, resource: { buffer: meBuffer } },
                { binding: 8, resource: { buffer: liBuffer } },
            ],
        });
        return bindGroup;
    }

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
    
    canvas.addEventListener("wheel", function(ev) {
        ev.preventDefault();
        let zoom = ev.deltaY > 0 ? 0.95 : 1.05;
        uniforms[1] *= zoom; 
        animate();
    });

    
    
    var bindGroup;
    function animate() 
    {
        if (!g_drawingInfo && g_objDoc && g_objDoc.isMTLComplete()) 
        {
            // OBJ and all MTLs are available
            bindGroup = onReadComplete(device, pipeline);
        }
        if (!g_drawingInfo) 
        {
            requestAnimationFrame(animate);
            return;
        }
        render();
    }
    
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
        pass.setBindGroup(0, bindGroup);
        pass.draw(4);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }
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