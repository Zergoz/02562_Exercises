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
    
    const texture = await load_texture(device, "grass.jpg");
    
    var groupNumber = 0;
    var bindGroups = [];
    for (var i = 0; i < 4; ++i) {
        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: texture.samplers[i] },
                { binding: 1, resource: texture.createView() }
            ],
        });
        bindGroups.push(bindGroup)
    }
    var addressMenu = document.getElementById("addressMenu");
    addressMenu.addEventListener("change", function(ev) {
        groupNumber = parseInt(addressMenu.value) + parseInt(filterMenu.value);
        requestAnimationFrame(animate);
    });
    
    var filterMenu = document.getElementById("filterMenu");
    filterMenu.addEventListener("change", function(ev) {
        groupNumber = parseInt(addressMenu.value) + parseInt(filterMenu.value);
        requestAnimationFrame(animate);
    });
    
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
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
        });
        device.queue.writeTexture({ texture: texture }, textureData,
        { offset: 0, bytesPerRow: img.width*4, rowsPerImage: img.height, }, [img.width, img.height, 1]);
        
        // Create sampler
        texture.samplers = [];
        
        texture.samplers.push(device.createSampler({
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            minFilter: "nearest",
            magFilter: "nearest",
        }));
        texture.samplers.push(device.createSampler({
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            minFilter: "linear",
            magFilter: "linear",
        }));
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


    function render() {
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